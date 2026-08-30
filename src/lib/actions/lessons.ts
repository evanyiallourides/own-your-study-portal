"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionResult } from "@/lib/actions/result";
import { getRepository } from "@/lib/data";
import { isDemoMode } from "@/lib/env";
import { isGoogleConfigured } from "@/lib/google/oauth";
import { parseMeetingLink } from "@/lib/meetings/links";
import { FILE_CATEGORIES, LESSON_STATUSES, MEETING_PLATFORMS } from "@/lib/types";
import type { MeetingPlatform } from "@/lib/types";

/* ==========================================================================
   Lesson actions
   --------------------------------------------------------------------------
   Every payload is parsed before it reaches the repository. A server action is
   a public HTTP endpoint whatever it looks like in the source, so "the form
   only sends valid values" is not a claim worth relying on.
   ========================================================================== */

/** Textareas collect one item per line. Blank lines are dropped rather than
 *  stored as empty bullets, and each item is length-capped so a paste accident
 *  cannot write a megabyte into a JSONB array. */
const lineList = z
  .string()
  .max(20_000)
  .transform((value) =>
    value
      .split("\n")
      .map((line) => line.replace(/^[-•*]\s*/, "").trim())
      .filter(Boolean)
      .map((line) => line.slice(0, 600))
      .slice(0, 40),
  );

const notesSchema = z.object({
  lessonId: z.string().min(1),
  title: z.string().max(200).optional(),
  summary: z.string().max(20_000),
  topicsCovered: lineList,
  keyConcepts: lineList,
  strengths: lineList,
  areasForImprovement: lineList,
  misconceptions: lineList,
  homework: lineList,
  resourcesMentioned: lineList,
  nextSteps: lineList,
  tutorPrivateNotes: z.string().max(20_000),
});

export type LessonNotesFormInput = z.input<typeof notesSchema>;

async function saveNotes(input: LessonNotesFormInput) {
  const parsed = notesSchema.parse(input);
  const repo = await getRepository();

  if (parsed.title !== undefined) {
    await repo.updateLesson(parsed.lessonId, { title: parsed.title.trim() || null });
  }

  await repo.saveLessonNotes(parsed.lessonId, {
    summary: parsed.summary.trim() || null,
    topicsCovered: parsed.topicsCovered,
    keyConcepts: parsed.keyConcepts,
    strengths: parsed.strengths,
    areasForImprovement: parsed.areasForImprovement,
    misconceptions: parsed.misconceptions,
    homework: parsed.homework,
    resourcesMentioned: parsed.resourcesMentioned,
    nextSteps: parsed.nextSteps,
    tutorPrivateNotes: parsed.tutorPrivateNotes.trim() || null,
  });

  return { repo, lessonId: parsed.lessonId };
}

function revalidateLesson(lessonId: string) {
  revalidatePath(`/tutor/lessons/${lessonId}`, "layout");
  revalidatePath(`/student/lessons/${lessonId}`, "layout");
  revalidatePath("/tutor");
  revalidatePath("/tutor/lessons");
  revalidatePath("/student");
  revalidatePath("/student/lessons");
  revalidatePath("/student/homework");
}

export async function saveLessonNotesDraft(input: LessonNotesFormInput): Promise<ActionResult> {
  try {
    const { lessonId } = await saveNotes(input);
    revalidateLesson(lessonId);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/** Save, then release to the student. Kept as one action so a tutor cannot
 *  publish a version different from the one on their screen. */
export async function publishLessonNotes(input: LessonNotesFormInput): Promise<ActionResult> {
  try {
    const { repo, lessonId } = await saveNotes(input);
    await repo.publishLesson(lessonId);
    revalidateLesson(lessonId);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function unpublishLesson(lessonId: string): Promise<ActionResult> {
  try {
    const repo = await getRepository();
    await repo.unpublishLesson(z.string().min(1).parse(lessonId));
    revalidateLesson(lessonId);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/* -- scheduling ----------------------------------------------------------- */

const createLessonSchema = z.object({
  studentId: z.string().min(1),
  tutorId: z.string().min(1),
  subjectId: z.string().min(1),
  title: z.string().max(200).optional(),
  // datetime-local gives a naive local time; the browser's zone resolves it.
  scheduledAt: z.string().min(1),
  durationMinutes: z.coerce.number().int().min(5).max(480),
  meetingUrl: z.string().max(2000).optional(),
  meetingPlatform: z.enum(MEETING_PLATFORMS),
  notetakerEnabled: z.boolean().default(false),
  /** Ask Google to mint a Meet link and put the lesson in both calendars. */
  createMeetLink: z.boolean().default(false),
});

export async function createLesson(
  input: z.input<typeof createLessonSchema>,
): Promise<ActionResult<{ lessonId: string; meetWarning?: string }>> {
  const parsed = createLessonSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the lesson details — something was missing or invalid." };
  }

  const when = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(when.getTime())) {
    return { ok: false, error: "That date and time could not be read." };
  }

  /* The link is parsed, not merely pattern-matched: a bare Meet code and a
     calendar's wrapped redirect are both things people paste, and both become
     the same canonical URL. The platform then comes from the link itself
     rather than from the dropdown, so the two cannot disagree. */
  const raw = parsed.data.meetingUrl?.trim() ?? "";
  const link = raw ? parseMeetingLink(raw) : null;
  if (raw && !link) {
    return {
      ok: false,
      error: "That does not look like a meeting link. Paste the full URL, or a Google Meet code.",
    };
  }

  try {
    const repo = await getRepository();
    const lesson = await repo.createLesson({
      studentId: parsed.data.studentId,
      tutorId: parsed.data.tutorId,
      subjectId: parsed.data.subjectId,
      title: parsed.data.title?.trim() || null,
      scheduledAt: when.toISOString(),
      durationMinutes: parsed.data.durationMinutes,
      meetingUrl: link?.url ?? null,
      meetingPlatform: link?.platform ?? parsed.data.meetingPlatform,
      notetakerEnabled: parsed.data.notetakerEnabled,
    });

    /* Google comes after the lesson is safely in the database, so an outage
       at Google costs a meeting link rather than the booking. A failure here
       is reported as a warning on a successful create, not as an error — the
       lesson genuinely exists and telling the tutor otherwise would be a lie
       that makes them book it twice. */
    let meetWarning: string | undefined;
    if (parsed.data.createMeetLink && !link) {
      const outcome = await createMeetForLesson(repo, lesson.id);
      if (!outcome.ok) meetWarning = outcome.reason;
    }

    revalidatePath("/tutor");
    revalidatePath("/tutor/schedule");
    revalidatePath("/tutor/lessons");
    revalidatePath("/admin/lessons");
    revalidatePath("/student");
    return { ok: true, data: { lessonId: lesson.id, meetWarning } };
  } catch (error) {
    return toActionError(error);
  }
}

/** Bridge to the Google integration. Kept here rather than inline so the
 *  demo-mode refusal and the not-configured refusal read identically to the
 *  caller, and so nothing in the action imports a server-only module unless
 *  the tutor actually asked for a link. */
async function createMeetForLesson(
  repo: Awaited<ReturnType<typeof getRepository>>,
  lessonId: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (isDemoMode()) {
    return { ok: false, reason: "Demo mode cannot create a real Google Meet link." };
  }
  if (!isGoogleConfigured()) {
    return {
      ok: false,
      reason:
        "Google is not configured on this deployment. Paste a meeting link into the lesson instead.",
    };
  }

  const lesson = await repo.getLesson(lessonId);
  if (!lesson) return { ok: false, reason: "The lesson could not be read back." };

  const { attachGoogleMeet } = await import("@/lib/google/schedule");
  const result = await attachGoogleMeet(repo, lesson, repo.session.profile.id);
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

/** Keep a portal-created calendar event in step, or remove it when the lesson
 *  is cancelled. Silent on failure by design: the lesson change has already
 *  been saved, and a calendar that is briefly out of date is not worth
 *  reporting as a failed edit. The drift is visible on the lesson page. */
async function syncMeetForLesson(
  repo: Awaited<ReturnType<typeof getRepository>>,
  lessonId: string,
  cancelled: boolean,
): Promise<void> {
  if (isDemoMode() || !isGoogleConfigured()) return;

  const lesson = await repo.getLesson(lessonId).catch(() => null);
  if (!lesson?.meetLinkManaged) return;

  const { syncGoogleMeet, cancelGoogleMeet } = await import("@/lib/google/schedule");
  await (cancelled ? cancelGoogleMeet(repo, lesson) : syncGoogleMeet(lesson)).catch(
    () => undefined,
  );
}

/**
 * Create a Meet link for a lesson that has not got one.
 *
 * The same path scheduling uses, exposed on its own so a link can be made
 * after the fact — which is the common case, because a tutor books a run of
 * lessons and sorts the links out later.
 */
export async function generateMeetLink(lessonId: string): Promise<ActionResult> {
  if (!lessonId) return { ok: false, error: "No lesson was specified." };

  try {
    const repo = await getRepository();
    const lesson = await repo.getLesson(lessonId);
    if (!lesson) return { ok: false, error: "That lesson could not be found." };

    /* Refused rather than silently replaced. Overwriting a link somebody
       pasted in would strand whoever already has it, and the tutor cannot see
       from a dashboard button which of those two things they are about to do. */
    if (lesson.meetingUrl) {
      return {
        ok: false,
        error: "This lesson already has a meeting link. Clear it on the lesson page first.",
      };
    }

    const outcome = await createMeetForLesson(repo, lessonId);
    if (!outcome.ok) return { ok: false, error: outcome.reason ?? "The link could not be created." };

    revalidateLesson(lessonId);
    revalidatePath("/tutor");
    revalidatePath("/tutor/schedule");
    revalidatePath("/tutor/lessons");
    revalidatePath("/student");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

const updateLessonSchema = z.object({
  lessonId: z.string().min(1),
  title: z.string().max(200).optional(),
  scheduledAt: z.string().optional(),
  durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
  meetingUrl: z.string().max(2000).optional(),
  meetingPlatform: z.enum(MEETING_PLATFORMS).optional(),
  status: z.enum(LESSON_STATUSES).optional(),
  notetakerEnabled: z.boolean().optional(),
});

export async function updateLesson(
  input: z.input<typeof updateLessonSchema>,
): Promise<ActionResult> {
  const parsed = updateLessonSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That change could not be applied." };

  const { lessonId, scheduledAt, ...rest } = parsed.data;

  /* Clearing the link is meaningful, so an empty string and an absent field
     are kept apart: the first removes the link, the second leaves it alone. */
  let meeting: { meetingUrl: string | null; meetingPlatform?: MeetingPlatform } | null = null;
  if (rest.meetingUrl !== undefined) {
    const raw = rest.meetingUrl.trim();
    if (!raw) {
      meeting = { meetingUrl: null };
    } else {
      const link = parseMeetingLink(raw);
      if (!link) {
        return {
          ok: false,
          error: "That does not look like a meeting link. Paste the full URL, or a Google Meet code.",
        };
      }
      meeting = { meetingUrl: link.url, meetingPlatform: link.platform };
    }
  }

  // `published` is never settable from here — publishing goes through the
  // review flow, which is the only path that also releases the homework.
  if (rest.status === "published") {
    return { ok: false, error: "Use the review page to publish a lesson." };
  }

  try {
    const repo = await getRepository();
    await repo.updateLesson(lessonId, {
      ...rest,
      ...(rest.title !== undefined ? { title: rest.title.trim() || null } : {}),
      ...(meeting ?? {}),
      ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
    });
    /* If the portal created this lesson's calendar event, a change of time or
       title here has to reach the calendar too — otherwise the student's own
       calendar keeps the old time and they turn up to the wrong one. Only
       events we made are touched; a pasted link belongs to whoever made it. */
    await syncMeetForLesson(repo, lessonId, rest.status === "cancelled");

    revalidateLesson(lessonId);
    revalidatePath("/tutor/schedule");
    revalidatePath("/admin/lessons");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/* -- files ---------------------------------------------------------------- */

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "text/plain",
  "text/markdown",
]);

export async function uploadLessonFile(formData: FormData): Promise<ActionResult> {
  const lessonId = String(formData.get("lessonId") ?? "");
  const categoryRaw = String(formData.get("category") ?? "resource");
  const file = formData.get("file");

  if (!lessonId) return { ok: false, error: "No lesson was specified." };
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "That file is larger than 25 MB. Boards and worksheets should be well under this." };
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return {
      ok: false,
      error: "That file type is not accepted. Use a PDF, an image, or a Word or PowerPoint document.",
    };
  }

  const categoryParse = z.enum(FILE_CATEGORIES).safeParse(categoryRaw);
  if (!categoryParse.success) return { ok: false, error: "Unknown file category." };

  try {
    const repo = await getRepository();
    await repo.uploadLessonFile({
      lessonId,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      category: categoryParse.data,
      body: await file.arrayBuffer(),
    });
    revalidateLesson(lessonId);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteLessonFile(input: {
  fileId: string;
  lessonId: string;
}): Promise<ActionResult> {
  try {
    const repo = await getRepository();
    await repo.deleteLessonFile(z.string().min(1).parse(input.fileId));
    revalidateLesson(input.lessonId);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
