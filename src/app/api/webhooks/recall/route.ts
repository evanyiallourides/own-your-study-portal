import { NextResponse, type NextRequest } from "next/server";

import { processLessonTranscript } from "@/lib/recall/pipeline";
import { deliveryId, verifyWebhookSignature } from "@/lib/recall/webhook";
import type { RecallWebhookEvent } from "@/lib/recall/types";
import { env, isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* ==========================================================================
   POST /api/webhooks/recall
   --------------------------------------------------------------------------
   Recall calls this when a bot's state changes. Four properties matter:

     · Verified — the raw body is checked against the Svix signature before it
       is parsed. No secret configured means every request is refused.
     · Idempotent — each delivery is recorded in webhook_events under a unique
       (provider, event_id). A redelivery is acknowledged and dropped, so a
       transcript is never analysed twice.
     · Quiet — nothing from the payload is logged beyond ids and event names.
       Transcript text must not end up in an application log.
     · Always 2xx once accepted — a 5xx makes Recall retry, and a retry of an
       event we have already stored achieves nothing. Failures are recorded on
       the lesson and surfaced in the admin dashboard instead.
   ========================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (isDemoMode()) {
    // No database to write to. Refusing is more honest than pretending.
    return NextResponse.json(
      { error: "The portal is running in demo mode and cannot accept webhooks." },
      { status: 503 },
    );
  }

  // Raw text, before any parsing — the signature covers the exact bytes sent.
  const rawBody = await request.text();

  const verification = verifyWebhookSignature(rawBody, request.headers, env.recallWebhookSecret);
  if (!verification.ok) {
    console.warn("[recall] rejected webhook:", verification.reason);
    return NextResponse.json({ error: verification.reason }, { status: verification.status });
  }

  let event: RecallWebhookEvent;
  try {
    event = JSON.parse(rawBody) as RecallWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Body was not valid JSON." }, { status: 400 });
  }

  const eventType = typeof event.event === "string" ? event.event : "unknown";
  const botId = event.data?.bot_id ?? event.data?.bot?.id ?? null;
  const metadata = event.data?.metadata ?? event.data?.bot?.metadata ?? {};
  const lessonIdFromMetadata =
    typeof metadata?.lesson_id === "string" ? metadata.lesson_id : null;

  const db = createSupabaseAdminClient();
  const eventId = deliveryId(rawBody, request.headers);

  /* -- Idempotency. The unique index is the guard, not this select: two
        simultaneous deliveries both pass a check-then-act, but only one can
        win the insert. -- */
  const { error: insertError } = await db.from("webhook_events").insert({
    provider: "recall",
    event_id: eventId,
    event_type: eventType,
    lesson_id: lessonIdFromMetadata,
    status: "received",
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ ok: true, deduplicated: true });
    }
    console.error("[recall] could not record delivery:", insertError.code);
    return NextResponse.json({ error: "Could not record the delivery." }, { status: 500 });
  }

  const finish = async (status: string, detail?: string) => {
    await db
      .from("webhook_events")
      .update({
        status,
        processed_at: new Date().toISOString(),
        error_message: detail ?? null,
      })
      .eq("provider", "recall")
      .eq("event_id", eventId);
  };

  if (!botId) {
    await finish("ignored", "No bot id on the payload.");
    return NextResponse.json({ ok: true, ignored: true });
  }

  // Resolve the lesson: metadata first, the stored bot id as the fallback for
  // payload shapes that do not echo metadata back.
  let lessonId = lessonIdFromMetadata;
  if (!lessonId) {
    const { data } = await db
      .from("lessons")
      .select("id")
      .eq("recall_bot_id", botId)
      .maybeSingle();
    lessonId = (data?.id as string | undefined) ?? null;
  }

  if (!lessonId) {
    await finish("ignored", "No lesson matches this bot.");
    return NextResponse.json({ ok: true, ignored: true });
  }

  await db.from("webhook_events").update({ lesson_id: lessonId }).eq("event_id", eventId).eq("provider", "recall");

  try {
    switch (eventType) {
      case "bot.in_call_recording":
      case "bot.recording.started":
        await db.from("lessons").update({ status: "in_progress", started_at: new Date().toISOString() }).eq("id", lessonId);
        await finish("processed");
        break;

      case "bot.done":
      case "bot.call_ended":
      case "recording.done":
      case "transcript.done": {
        await db.from("lessons").update({ ended_at: new Date().toISOString() }).eq("id", lessonId);
        const result = await processLessonTranscript(lessonId, botId);
        await finish(result.status === "failed" ? "failed" : "processed", result.detail);
        break;
      }

      case "bot.fatal":
      case "bot.error":
      case "transcript.failed": {
        const message =
          typeof event.data?.status?.message === "string"
            ? event.data.status.message
            : "The notetaker could not complete this lesson.";
        await db
          .from("lessons")
          .update({ status: "failed", processing_error: message })
          .eq("id", lessonId);
        await finish("processed", message);
        break;
      }

      default:
        await finish("ignored", `Unhandled event type: ${eventType}`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Processing failed.";
    console.error("[recall] processing failed for lesson", lessonId, "-", detail);
    await finish("failed", detail);
    // Still a 200: the delivery is recorded, and a retry would be dropped as a
    // duplicate anyway. The failure is visible in the admin dashboard.
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json(
    { error: "This endpoint accepts signed POST requests from Recall only." },
    { status: 405 },
  );
}
