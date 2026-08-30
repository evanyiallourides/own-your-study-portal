"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionResult } from "@/lib/actions/result";
import { requireRole } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import { isDemoMode } from "@/lib/env";
import { createBot, isRecallConfigured, RecallNotConfiguredError } from "@/lib/recall/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Student } from "@/lib/types";

/* ==========================================================================
   Scheduling the notetaker
   --------------------------------------------------------------------------
   The consent gate lives here as well as in the database function, because
   this is the only place a bot is ever created. Both checks are cheap and the
   consequence of getting it wrong is recording a child without permission.
   ========================================================================== */

export function consentBlockers(student: Student, notetakerEnabledGlobally: boolean): string[] {
  const blockers: string[] = [];
  if (!notetakerEnabledGlobally) {
    blockers.push("The AI Notetaker is switched off for the whole organisation.");
  }
  if (!student.consent.aiNotetakerConsent) {
    blockers.push(`${student.profile.firstName} has not consented to the AI Notetaker.`);
  }
  if (!student.consent.transcriptionConsent) {
    blockers.push(`${student.profile.firstName} has not consented to transcription.`);
  }
  if (student.consent.guardianConsentRequired && !student.consent.guardianConsentReceived) {
    blockers.push("Guardian consent is required for this student and has not been recorded.");
  }
  return blockers;
}

export async function scheduleNotetaker(lessonId: string): Promise<ActionResult> {
  await requireRole("tutor", "admin");
  const parsed = z.string().min(1).safeParse(lessonId);
  if (!parsed.success) return { ok: false, error: "That lesson could not be found." };

  if (isDemoMode()) {
    return {
      ok: false,
      error:
        "Demo mode has no database and no Recall credentials, so a bot cannot be scheduled. Everything around this flow is real; only the call to Recall is absent.",
    };
  }
  if (!isRecallConfigured()) {
    return {
      ok: false,
      error: "RECALL_API_KEY is not set, so the notetaker cannot be scheduled into meetings.",
    };
  }

  try {
    const repo = await getRepository();
    const [lesson, settings] = await Promise.all([repo.getLesson(parsed.data), repo.getSettings()]);
    if (!lesson) return { ok: false, error: "That lesson could not be found." };
    if (!lesson.meetingUrl) {
      return { ok: false, error: "This lesson has no meeting link, so there is nothing to join." };
    }

    const blockers = consentBlockers(lesson.student, settings.notetakerEnabledGlobally);
    if (blockers.length > 0) {
      return { ok: false, error: `The notetaker was not scheduled. ${blockers.join(" ")}` };
    }

    const bot = await createBot({
      meetingUrl: lesson.meetingUrl,
      botName: settings.notetakerDisplayName,
      joinAt: lesson.scheduledAt,
      lessonId: lesson.id,
    });

    // Writing the bot id needs the service role: the tutor's own grant does
    // not extend to the notetaker columns, and should not.
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("lessons")
      .update({ recall_bot_id: bot.botId, notetaker_enabled: true, processing_error: null })
      .eq("id", lesson.id);
    if (error) throw new Error(error.message);

    revalidatePath(`/tutor/lessons/${lesson.id}`, "layout");
    revalidatePath("/admin/notetaker");
    return { ok: true };
  } catch (error) {
    if (error instanceof RecallNotConfiguredError) {
      return { ok: false, error: error.message };
    }
    return toActionError(error);
  }
}
