"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole, requireSession } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import { toActionError, type ActionResult } from "@/lib/actions/result";
import { isDemoMode, isSupabaseConfigured } from "@/lib/env";
import { notifyAdmins } from "@/lib/payments/entitlements";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MAX_UPLOAD_BYTES, UnreadableUploadError } from "@/lib/ia/extract";
import { isMarkingConfigured, markSubmission, MarkingUnavailableError } from "@/lib/ia/mark";
import { packLoader } from "@/lib/ia/pack-store";
import {
  DRAFT_STAGES,
  IA_LEVELS,
  IA_SUBJECTS,
  SUBJECT_LABEL,
  formatSession,
  parseSession,
  routeToRubric,
} from "@/lib/ia/rubrics";
import { storeSubmissionFile } from "@/lib/ia/storage";

/* ==========================================================================
   Submitting an IA for review
   --------------------------------------------------------------------------
   The order of operations is the product promise, so it is worth stating
   before the code:

     1. Check there is a credit. Refuse early, before anything is uploaded.
     2. Refuse a session we cannot mark, before anything is uploaded.
     3. Store the file.
     4. Run the review.
     5. Store the review.
     6. THEN spend the credit.

   Six after five, not before. A model call that times out, a PDF that turns
   out to be a photograph, a review that fails validation — none of them costs
   the student forty-five dollars, and the only way to guarantee that is for
   the charge to be the last thing that happens. The failure mode this leaves
   is a review that exists and was not paid for, which is a bookkeeping entry
   rather than a support ticket from somebody who has been charged for nothing.

   Steps 1 and 2 are before the upload rather than after because refusing a
   2029 Maths session after a student has waited for a 12 MB file is a bad way
   to tell them something we knew before they picked the file.
   ========================================================================== */

const id = z.string().trim().min(1).max(64);

const submitSchema = z.object({
  subject: z.enum(IA_SUBJECTS),
  level: z.enum(IA_LEVELS),
  session: z.string().trim().min(1).max(20),
  stage: z.enum(DRAFT_STAGES),
  /* The student's own note. Length-capped and nothing else: it goes into the
     prompt as evidence, clearly fenced, and the prompt's answer to "please
     give this a 7" is to ignore it and say so. Filtering for phrases here
     would be security theatre that also breaks "I'm worried my conclusion
     over-claims — is 7 too strong a word?" */
  note: z.string().trim().max(1500).optional(),
});

export interface SubmitOutcome {
  submissionId: string;
  mode: "marking" | "feedback_only";
}

export async function submitIaForReview(
  formData: FormData,
): Promise<ActionResult<SubmitOutcome>> {
  const session = await requireRole("student");
  if (!session.studentId) {
    return { ok: false, error: "This account has no student record." };
  }

  const parsed = submitSchema.safeParse({
    subject: formData.get("subject"),
    level: formData.get("level"),
    session: formData.get("session"),
    stage: formData.get("stage"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: "Please choose a subject, level, session and draft stage." };
  }

  const examSession = parseSession(parsed.data.session);
  if (!examSession) {
    return { ok: false, error: "That is not an examination session we recognise." };
  }

  /* -- 2. A model we can actually apply --------------------------------- */
  const { blocked } = routeToRubric(parsed.data.subject, examSession);
  if (blocked) {
    // Refused outright rather than accepted into feedback-only mode. A student
    // paying for a review of a 2029 exploration would get something honest and
    // much thinner than what they bought.
    return { ok: false, error: blocked };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Please choose the file with your IA in it." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `That file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. Export it as a PDF rather than embedding the original photographs.`,
    };
  }

  if (isDemoMode()) {
    return {
      ok: false,
      error:
        "The portal is in demo mode, so no review can run. Everything else on this page is real.",
    };
  }
  if (!isMarkingConfigured()) {
    return { ok: false, error: "IA review is not configured on this deployment." };
  }

  const repo = await getRepository();

  /* -- 1. A credit to spend --------------------------------------------- */
  const credits = await repo.getIaCredits(session.studentId);
  if (credits.balance < 1) {
    return {
      ok: false,
      error: "You have no IA reviews left. Buy one and it will appear here straight away.",
    };
  }

  let submissionId: string | null = null;

  try {
    const bytes = await file.arrayBuffer();

    /* -- 3. Store it --------------------------------------------------- */
    const stored = await storeSubmissionFile({
      studentId: session.studentId,
      fileName: file.name,
      contentType: file.type,
      bytes,
    });

    const submission = await repo.createIaSubmission({
      studentId: session.studentId,
      subject: parsed.data.subject,
      level: parsed.data.level,
      session: formatSession(examSession),
      stage: parsed.data.stage,
      storagePath: stored.path,
      fileName: file.name,
      fileSize: file.size,
      fileHash: stored.hash,
      wordCount: null,
      studentNote: parsed.data.note ?? null,
    });
    submissionId = submission.id;

    await repo.setIaSubmissionStatus(submission.id, "reviewing");

    /* -- 4. Review it -------------------------------------------------- */
    const outcome = await markSubmission({
      fileName: file.name,
      bytes,
      subject: parsed.data.subject,
      level: parsed.data.level,
      session: examSession,
      stage: parsed.data.stage,
      studentNote: parsed.data.note ?? null,
      packs: packLoader(),
    });

    /* -- 5. Store the review ------------------------------------------- */
    await repo.saveIaReview(submission.id, outcome.review);
    await repo.setIaSubmissionStatus(submission.id, "reviewed");

    /* -- 6. Only now, charge for it ------------------------------------ */
    await repo.spendIaCredit(
      session.studentId,
      `${SUBJECT_LABEL[parsed.data.subject]} ${parsed.data.level}, ${formatSession(examSession)}`,
    );

    revalidatePath("/student/ia-review");
    return { ok: true, data: { submissionId: submission.id, mode: outcome.review.mode } };
  } catch (error) {
    if (submissionId) {
      await repo
        .setIaSubmissionStatus(submissionId, "failed", failureNote(error))
        .catch(() => undefined);
    }
    revalidatePath("/student/ia-review");

    if (error instanceof UnreadableUploadError || error instanceof MarkingUnavailableError) {
      // Said plainly, and with the reassurance that matters most at this point.
      return { ok: false, error: `${error.message} You have not been charged.` };
    }
    return toActionError(error);
  }
}

function failureNote(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 400) : "The review could not be completed.";
}

/* --------------------------------------------------------------------------
   Asking for a person
   --------------------------------------------------------------------------
   The escalation from an automated review to a tutor who teaches the subject.
   It records the request and tells the administrators; it does not take a
   payment, because what it leads to is a conversation about the IA & EE
   Strategy Package rather than a second thing in a basket.
   -------------------------------------------------------------------------- */

const escalateSchema = z.object({ submissionId: id });

export async function requestProfessionalReview(
  input: z.input<typeof escalateSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = escalateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That is not a submission we know about." };

  try {
    const repo = await getRepository();
    // The repository re-checks whose submission it is; a student cannot
    // escalate somebody else's coursework by guessing an id.
    await repo.requestProfessionalReview(parsed.data.submissionId);

    /* Told to the practice rather than left in a queue nobody opens. A student
       asking for a person is the highest-intent thing that happens on this
       page, and a day's delay answering it is the difference between six hours
       of tutoring and a missed deadline.

       Best effort on purpose: the request is already recorded and visible on
       the administrator's list, so a notification that fails must not make the
       student think their request did. */
    if (!isDemoMode() && isSupabaseConfigured()) {
      const submission = await repo.getIaSubmission(parsed.data.submissionId);
      await notifyAdmins(
        createSupabaseAdminClient(),
        "ia_review_requested",
        "A student has asked for a tutor to read their IA",
        submission
          ? `${SUBJECT_LABEL[submission.submission.subject]} ${submission.submission.level}, ` +
            `${submission.submission.session}. They have had the automated review and want a person. ` +
            `This is the conversation about the IA & EE Strategy Package.`
          : "See the IA reviews list.",
      ).catch(() => undefined);
    }

    revalidatePath(`/student/ia-review/${parsed.data.submissionId}`);
    revalidatePath("/admin/ia-reviews");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/* --------------------------------------------------------------------------
   Credits, by hand
   -------------------------------------------------------------------------- */

const grantSchema = z.object({
  studentId: id,
  count: z.coerce.number().int().min(-20).max(20),
  note: z.string().trim().min(1).max(200),
});

/** An administrator adding or correcting credits. Always leaves a ledger row. */
export async function grantIaCredits(
  input: z.input<typeof grantSchema>,
): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Give a number between -20 and 20, and say why." };
  }
  if (parsed.data.count === 0) return { ok: false, error: "That would change nothing." };

  try {
    const repo = await getRepository();
    await repo.grantIaCredits(parsed.data.studentId, parsed.data.count, parsed.data.note);
    revalidatePath(`/admin/students/${parsed.data.studentId}`);
    revalidatePath("/student/ia-review");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
