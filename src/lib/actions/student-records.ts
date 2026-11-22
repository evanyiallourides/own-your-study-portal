"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import { toActionError, type ActionResult } from "@/lib/actions/result";

/* ==========================================================================
   A student's standing records
   --------------------------------------------------------------------------
   Tutoring hours, class boards and the study plan. The repository (and RLS
   beneath it) decides whether this tutor teaches this student; the role checks
   here only keep students and parents from reaching the writes at all.
   ========================================================================== */

const id = z.string().trim().min(1).max(64);

function refreshStudentPages(studentId: string) {
  revalidatePath("/student");
  revalidatePath("/student/plan");
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath(`/tutor/students/${studentId}`);
  revalidatePath("/parent");
}

/* -- hours ---------------------------------------------------------------- */

const hoursSchema = z.object({
  studentId: id,
  // Half-hour steps, either direction. A negative is a correction, not a delete.
  hours: z
    .number()
    .min(-200)
    .max(200)
    .refine((h) => Number.isInteger(h * 2), "Use whole or half hours."),
  note: z.string().trim().min(3).max(200),
});

export async function adjustTutoringHours(
  input: z.input<typeof hoursSchema>,
): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = hoursSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Give a number of hours (halves allowed, up to 200) and say why." };
  }
  if (parsed.data.hours === 0) return { ok: false, error: "That would change nothing." };

  try {
    const repo = await getRepository();
    await repo.adjustTutoringHours(
      parsed.data.studentId,
      Math.round(parsed.data.hours * 60),
      parsed.data.note,
    );
    refreshStudentPages(parsed.data.studentId);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/* -- class boards ----------------------------------------------------------- */

const boardSchema = z.object({
  studentId: id,
  subjectId: z
    .string()
    .trim()
    .max(64)
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  label: z.string().trim().min(1).max(80),
  // https only, matching the database check. http: and javascript: links are
  // refused here so the student never sees them, and in SQL so nothing else
  // can write one either.
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === "https:" && !/\s/.test(value);
      } catch {
        return false;
      }
    }, "Paste the full https:// link to the board."),
});

export async function addClassBoard(input: z.input<typeof boardSchema>): Promise<ActionResult> {
  await requireRole("tutor", "admin");
  const parsed = boardSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message.startsWith("Paste")
        ? parsed.error.issues[0].message
        : "Give the board a name and paste its https:// link.",
    };
  }

  try {
    const repo = await getRepository();
    await repo.addClassBoard(parsed.data);
    refreshStudentPages(parsed.data.studentId);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function removeClassBoard(input: { boardId: string; studentId: string }): Promise<ActionResult> {
  await requireRole("tutor", "admin");
  const parsed = z.object({ boardId: id, studentId: id }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That board could not be found." };

  try {
    const repo = await getRepository();
    await repo.removeClassBoard(parsed.data.boardId);
    refreshStudentPages(parsed.data.studentId);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/* -- study plan ------------------------------------------------------------- */

/** One item per line, blanks and bullets dropped. */
function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

const planSchema = z.object({
  studentId: id,
  review: z.string().max(6000),
  goals: z.string().max(4000),
  focusAreas: z.string().max(4000),
  nextReviewOn: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a date for the next review."),
});

export async function saveStudyPlan(input: z.input<typeof planSchema>): Promise<ActionResult> {
  await requireRole("tutor", "admin");
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "The plan is too long, or the review date is not a date." };
  }

  const review = parsed.data.review.trim();
  const goals = lines(parsed.data.goals);
  const focusAreas = lines(parsed.data.focusAreas);
  if (!review && goals.length === 0 && focusAreas.length === 0) {
    return { ok: false, error: "Write a review, or at least one goal or focus area." };
  }

  try {
    const repo = await getRepository();
    await repo.saveStudyPlan(parsed.data.studentId, {
      review: review || null,
      goals,
      focusAreas,
      nextReviewOn: parsed.data.nextReviewOn || null,
    });
    refreshStudentPages(parsed.data.studentId);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
