import "server-only";

import { analyseLesson, analysisToNotesPatch, AnalysisUnavailableError } from "@/lib/ai/analyze";
import { fetchTranscript } from "@/lib/recall/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { mapSegments } from "@/lib/data/mappers";
import type { TranscriptSegment } from "@/lib/types";

/* ==========================================================================
   Transcript → notes pipeline
   --------------------------------------------------------------------------
   The one path from "the meeting ended" to "a tutor has something to review".
   It runs with the service role because there is no signed-in user behind a
   webhook, which is exactly why it is confined to this file and does nothing
   but the steps below.

       transcript fetched → stored → analysed → notes drafted
       → lesson marked review_required → tutor notified

   It never publishes. Nothing here can make a lesson visible to a student.
   ========================================================================== */

export interface PipelineResult {
  status: "completed" | "skipped" | "failed";
  detail: string;
}

interface LessonRow {
  id: string;
  student_id: string;
  tutor_id: string;
  subject_id: string;
  title: string | null;
  scheduled_at: string;
}

export async function processLessonTranscript(
  lessonId: string,
  botId: string,
): Promise<PipelineResult> {
  const db = createSupabaseAdminClient();

  const { data: lesson } = await db
    .from("lessons")
    .select("id, student_id, tutor_id, subject_id, title, scheduled_at")
    .eq("id", lessonId)
    .maybeSingle<LessonRow>();

  if (!lesson) {
    return { status: "skipped", detail: "No lesson matches this bot." };
  }

  // Already handled: a redelivered webhook must not overwrite a tutor's edits.
  const { data: existingNotes } = await db
    .from("lesson_notes")
    .select("id, tutor_reviewed")
    .eq("lesson_id", lessonId)
    .maybeSingle();

  if (existingNotes?.tutor_reviewed) {
    return { status: "skipped", detail: "This lesson has already been reviewed by its tutor." };
  }

  const [{ data: tutorRow }, { data: studentRow }, { data: subjectRow }] = await Promise.all([
    db.from("tutors").select("profile:profiles(first_name, last_name)").eq("id", lesson.tutor_id).maybeSingle(),
    db.from("students").select("profile:profiles(first_name, last_name)").eq("id", lesson.student_id).maybeSingle(),
    db.from("subjects").select("name, curriculum, level").eq("id", lesson.subject_id).maybeSingle(),
  ]);

  const name = (row: unknown): string => {
    const profile = (row as { profile?: { first_name?: string; last_name?: string } } | null)?.profile;
    return [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  };
  const tutorName = name(tutorRow) || "Tutor";
  const studentName = name(studentRow) || "Student";
  const subjectDisplayName = [subjectRow?.curriculum, subjectRow?.name, subjectRow?.level]
    .filter(Boolean)
    .join(" ");

  /* -- 1. transcript -- */
  await db.from("lessons").update({ status: "processing_transcript" }).eq("id", lessonId);

  let segments: TranscriptSegment[];
  try {
    segments = await fetchTranscript(botId, { tutorName, studentName });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The transcript could not be fetched.";
    await failLesson(db, lessonId, detail);
    return { status: "failed", detail };
  }

  if (segments.length === 0) {
    const detail = "The notetaker produced no transcript for this lesson.";
    await failLesson(db, lessonId, detail);
    return { status: "failed", detail };
  }

  await db.from("transcripts").upsert(
    {
      lesson_id: lessonId,
      speaker_segments_json: segments.map((s) => ({
        index: s.index,
        speaker: s.speaker,
        role: s.role,
        start_seconds: s.startSeconds,
        end_seconds: s.endSeconds,
        text: s.text,
      })),
      // The joined text is kept for search; the raw media is not kept at all.
      raw_transcript: segments.map((s) => `${s.speaker}: ${s.text}`).join("\n"),
      provider: "recall",
      provider_ref: botId,
      processing_status: "ready",
      duration_seconds: Math.round(segments[segments.length - 1]?.endSeconds ?? 0),
    },
    { onConflict: "lesson_id" },
  );

  /* -- 2. analysis -- */
  await db.from("lessons").update({ status: "generating_notes" }).eq("id", lessonId);

  // Context from the previous few published lessons, so the write-up can note
  // whether last time's weak spot has held.
  const { data: history } = await db
    .from("lessons")
    .select("id, title")
    .eq("student_id", lesson.student_id)
    .eq("subject_id", lesson.subject_id)
    .eq("published", true)
    .lt("scheduled_at", lesson.scheduled_at)
    .order("scheduled_at", { ascending: false })
    .limit(3);

  const previousIds = (history ?? []).map((h) => h.id as string);
  const { data: previousNotes } = previousIds.length
    ? await db.from("lesson_notes").select("areas_for_improvement").in("lesson_id", previousIds)
    : { data: [] };

  try {
    const analysis = await analyseLesson(segments, {
      tutorName,
      studentName,
      studentFirstName: studentName.split(" ")[0] ?? studentName,
      subjectDisplayName,
      previousLessonTitles: (history ?? [])
        .map((h) => h.title as string | null)
        .filter((t): t is string => Boolean(t)),
      previousAreasForImprovement: (previousNotes ?? [])
        .flatMap((n) => (Array.isArray(n.areas_for_improvement) ? n.areas_for_improvement : []))
        .filter((a): a is string => typeof a === "string")
        .slice(0, 8),
    });

    const patch = analysisToNotesPatch(analysis);

    await db.from("lesson_notes").upsert(
      {
        lesson_id: lessonId,
        summary: patch.summary,
        topics_covered: patch.topicsCovered,
        key_concepts: patch.keyConcepts,
        strengths: patch.strengths,
        areas_for_improvement: patch.areasForImprovement,
        misconceptions: patch.misconceptions,
        homework: patch.homework,
        resources_mentioned: patch.resourcesMentioned,
        next_steps: patch.nextSteps,
        tutor_private_notes: patch.tutorPrivateNotes,
        ai_generated: true,
        ai_model: process.env.OPENAI_MODEL ?? "gpt-4.1",
        ai_generated_at: new Date().toISOString(),
        tutor_reviewed: false,
      },
      { onConflict: "lesson_id" },
    );

    if (!lesson.title && analysis.lesson_title) {
      await db.from("lessons").update({ title: analysis.lesson_title }).eq("id", lessonId);
    }
  } catch (error) {
    if (error instanceof AnalysisUnavailableError) {
      // The transcript is safe and stored. The tutor can write the lesson up
      // by hand, so this is a review task rather than a failure.
      await db
        .from("lessons")
        .update({ processing_error: error.message })
        .eq("id", lessonId);
      await db.rpc("mark_lesson_review_required", { p_lesson_id: lessonId });
      return { status: "completed", detail: `Transcript stored. ${error.message}` };
    }
    const detail = error instanceof Error ? error.message : "Analysis failed.";
    await failLesson(db, lessonId, detail);
    return { status: "failed", detail };
  }

  /* -- 3. hand to the tutor -- */
  await db.rpc("mark_lesson_review_required", { p_lesson_id: lessonId });
  return { status: "completed", detail: "Transcript stored and a draft write-up is ready to review." };
}

async function failLesson(
  db: ReturnType<typeof createSupabaseAdminClient>,
  lessonId: string,
  detail: string,
): Promise<void> {
  await db.from("lessons").update({ status: "failed", processing_error: detail }).eq("id", lessonId);
  await db
    .from("transcripts")
    .upsert(
      { lesson_id: lessonId, processing_status: "failed", provider: "recall" },
      { onConflict: "lesson_id" },
    );
}

/** Re-exported so the webhook route can normalise stored segments without
 *  reaching into the mapper module directly. */
export { mapSegments };
