"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/states";
import { deleteLessonFile, uploadLessonFile } from "@/lib/actions/lessons";
import { FILE_CATEGORIES, type FileCategory } from "@/lib/types";

const CATEGORY_LABEL: Record<FileCategory, string> = {
  board: "Lesson board",
  worksheet: "Worksheet",
  homework: "Homework",
  resource: "Resource",
  other: "Other",
};

export function FileUpload({ lessonId, demo }: { lessonId: string; demo: boolean }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <div className="card p-5">
      <h3 className="font-display text-lg font-semibold">Upload a board or resource</h3>
      <p className="mt-1 text-sm text-ink-500">
        PDF, PNG, JPEG, Word or PowerPoint, up to 25 MB. The student sees it once the lesson is
        published.
      </p>

      {demo ? (
        <p className="mt-3 rounded-[8px] border border-warning/25 bg-warning-wash px-3 py-2 text-sm text-warning">
          Demo mode has no file storage. The upload will be recorded so you can see the flow, but
          the file itself is not kept.
        </p>
      ) : null}

      {error ? (
        <div className="mt-4">
          <ErrorState title="Upload failed" description={error} />
        </div>
      ) : null}

      <form
        ref={formRef}
        action={(formData) => {
          setError(null);
          startTransition(async () => {
            const result = await uploadLessonFile(formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            formRef.current?.reset();
            setFileName(null);
            router.refresh();
          });
        }}
        className="mt-5 space-y-4"
      >
        <input type="hidden" name="lessonId" value={lessonId} />

        <div>
          <label htmlFor="file" className="field-label">
            File
          </label>
          <input
            id="file"
            name="file"
            type="file"
            required
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx,.ppt,.pptx,.txt,.md"
            className="field file:mr-3 file:rounded-full file:border-0 file:bg-paper-2 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink-700 hover:file:bg-rule-soft"
          />
          {fileName ? <p className="mt-1.5 text-xs text-ink-300">Selected: {fileName}</p> : null}
        </div>

        <div>
          <label htmlFor="category" className="field-label">
            What is it
          </label>
          <select id="category" name="category" defaultValue="board" className="field">
            {FILE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_LABEL[category]}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" variant="solid" disabled={pending}>
          {pending ? "Uploading…" : "Upload"}
        </Button>
      </form>
    </div>
  );
}

export function DeleteFileButton({ fileId, lessonId }: { fileId: string; lessonId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (error) {
    return <p className="text-xs text-danger">{error}</p>;
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs font-medium text-ink-300 transition-colors hover:text-danger"
      >
        Remove
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className="text-ink-500">Remove this file?</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteLessonFile({ fileId, lessonId });
            if (!result.ok) setError(result.error);
            else router.refresh();
          })
        }
        className="font-semibold text-danger hover:underline"
      >
        {pending ? "Removing…" : "Yes, remove"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="font-medium text-ink-500 hover:underline"
      >
        Cancel
      </button>
    </span>
  );
}
