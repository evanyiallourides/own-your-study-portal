import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* ==========================================================================
   Where a submitted IA is kept
   --------------------------------------------------------------------------
   A private bucket, one folder per submission, and a signed URL per read.

   Written with the service role rather than as the student, and the migration
   says why: a client that could write into this bucket directly could store a
   document without spending a credit. The storage policy therefore lets
   administrators write and everybody else only read what their submission
   already entitles them to.

   The file is kept rather than discarded after the review for two reasons that
   are both about the student: they will want to see what they sent when they
   read the feedback six weeks later, and a tutor doing the professional review
   needs the actual document rather than a summary of it. It is deleted with
   the submission, which cascades from the student.
   ========================================================================== */

const BUCKET = "ia-submissions";

export interface StoredSubmission {
  path: string;
  hash: string;
}

export interface StoreInput {
  studentId: string;
  fileName: string;
  contentType: string;
  bytes: ArrayBuffer;
}

export async function storeSubmissionFile(input: StoreInput): Promise<StoredSubmission> {
  const db = createSupabaseAdminClient();
  const hash = await sha256(input.bytes);

  /* The folder is a fresh random id rather than the submission's own, because
     the file is stored before the row exists — the row records the path, so
     it has to be known first. A collision would need two crypto.randomUUID()
     calls to agree. */
  const folder = crypto.randomUUID();
  const path = `ia/${folder}/${safeName(input.fileName)}`;

  const { error } = await db.storage.from(BUCKET).upload(path, input.bytes, {
    contentType: contentTypeFor(input.fileName, input.contentType),
    // Never overwrite. Two uploads of the same document are two submissions,
    // and the second must not silently replace the file the first was reviewed
    // from — a review whose document has changed underneath it is unauditable.
    upsert: false,
  });

  if (error) throw new Error(`Could not store that file: ${error.message}`);
  return { path, hash };
}

/** A link the student's browser can follow, valid for long enough to click. */
export async function signedUrlFor(path: string, seconds = 300): Promise<string | null> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, seconds);
  return error ? null : (data?.signedUrl ?? null);
}

/**
 * The content type the bucket will accept.
 *
 * Browsers disagree about .docx — some send the full OOXML type, some send
 * application/octet-stream, and Safari occasionally sends nothing. The bucket
 * has an allow-list, so a wrong guess here is a failed upload with a message
 * about MIME types, which is not a thing to make a sixteen-year-old read.
 */
function contentTypeFor(fileName: string, declared: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (ext === "md") return "text/markdown";
  if (ext === "txt") return "text/plain";
  return declared || "application/octet-stream";
}

/** The student named this; it becomes part of an object key. */
function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "submission";
  return base.replace(/[^\w.\-]+/g, "_").slice(0, 100) || "submission";
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
