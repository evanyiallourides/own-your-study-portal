import "server-only";

import { env } from "@/lib/env";
import type {
  RecallRegion,
  RecallTranscriptEntry,
  ScheduleBotInput,
  ScheduledBot,
} from "@/lib/recall/types";
import type { TranscriptSegment } from "@/lib/types";

/* ==========================================================================
   Recall.ai client
   --------------------------------------------------------------------------
   The meeting bot that joins a lesson, produces a transcript, and hands it
   back. Everything the portal needs from Recall goes through this file, so the
   provider can be swapped without touching the pipeline.

   ── Status ───────────────────────────────────────────────────────────────
   These are real HTTP calls, not a simulation. With no RECALL_API_KEY set,
   every method throws RecallNotConfiguredError and the portal continues to
   work without a notetaker; nothing anywhere pretends a bot was scheduled.

   ── Before enabling in production ────────────────────────────────────────
   Recall's request and response bodies have changed shape between API
   versions. The endpoints and auth scheme below follow their v1 API, and the
   response parsing is written defensively, but you should check the current
   docs at https://docs.recall.ai against `createBot` and `fetchTranscript`
   before turning this on for real lessons. The webhook handler does not
   depend on these shapes.
   ========================================================================== */

export class RecallNotConfiguredError extends Error {
  constructor() {
    super(
      "RECALL_API_KEY is not set, so the AI Notetaker cannot be scheduled. Lessons still work; there will simply be no transcript.",
    );
    this.name = "RecallNotConfiguredError";
  }
}

export class RecallApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RecallApiError";
    this.status = status;
  }
}

function baseUrl(region: string): string {
  const known: RecallRegion[] = ["us-east-1", "us-west-2", "eu-central-1", "ap-northeast-1"];
  const resolved = (known as string[]).includes(region) ? region : "us-west-2";
  return `https://${resolved}.recall.ai/api/v1`;
}

export function isRecallConfigured(): boolean {
  return Boolean(env.recallApiKey);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const apiKey = env.recallApiKey;
  if (!apiKey) throw new RecallNotConfiguredError();

  const response = await fetch(`${baseUrl(env.recallRegion)}${path}`, {
    ...init,
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    // Recall is not a hot path; a slow response should fail rather than hang
    // a webhook worker indefinitely.
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new RecallApiError(
      `Recall responded ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

/**
 * Schedule the notetaker into a meeting.
 *
 * The lesson id travels in `metadata` rather than in a lookup table, so a
 * webhook can be resolved to a lesson even if it arrives out of order or after
 * a restart. `bot_name` is the disclosure: everyone in the call sees it.
 */
export async function createBot(input: ScheduleBotInput): Promise<ScheduledBot> {
  const payload = {
    meeting_url: input.meetingUrl,
    bot_name: input.botName,
    join_at: input.joinAt,
    metadata: { lesson_id: input.lessonId },
    recording_config: {
      transcript: {
        // Recall's own diarised transcription. Swapping provider here is the
        // one change needed to move to Deepgram/AssemblyAI/etc.
        provider: { recallai_streaming: {} },
      },
    },
  };

  const response = await request<{ id?: string; status_changes?: { code?: string }[] }>("/bot/", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!response.id) {
    throw new RecallApiError("Recall did not return a bot id.", 502);
  }

  return {
    botId: response.id,
    status: response.status_changes?.at(-1)?.code ?? "scheduled",
  };
}

/** Remove a scheduled bot — used when a lesson is cancelled or rescheduled. */
export async function deleteBot(botId: string): Promise<void> {
  await request(`/bot/${botId}/`, { method: "DELETE" });
}

export async function fetchBot(botId: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/bot/${botId}/`);
}

/**
 * Pull the finished transcript and reduce it to the portal's own segment
 * shape. Recall returns per-word timings; a viewer wants turns, so words are
 * collapsed back into the utterance they came from.
 */
export async function fetchTranscript(
  botId: string,
  speakerRoles: { tutorName: string; studentName: string },
): Promise<TranscriptSegment[]> {
  const raw = await request<RecallTranscriptEntry[] | { transcript?: RecallTranscriptEntry[] }>(
    `/bot/${botId}/transcript/`,
  );
  const entries = Array.isArray(raw) ? raw : (raw.transcript ?? []);
  return toSegments(entries, speakerRoles);
}

/** Exported for testing: the mapping is the part most likely to need adjusting
 *  when Recall changes its payload, so it is pure and independently checkable. */
export function toSegments(
  entries: RecallTranscriptEntry[],
  { tutorName, studentName }: { tutorName: string; studentName: string },
): TranscriptSegment[] {
  const normalise = (value: string) => value.trim().toLowerCase();
  const tutorKey = normalise(tutorName);
  const studentKey = normalise(studentName);

  const segments: TranscriptSegment[] = [];

  for (const entry of entries) {
    const words = entry.words ?? [];
    if (words.length === 0) continue;

    const text = words
      .map((w) => w.text)
      .join(" ")
      .replace(/\s+([,.!?;:])/g, "$1")
      .trim();
    if (!text) continue;

    const speaker = entry.participant?.name?.trim() || "Speaker";
    const key = normalise(speaker);
    const role: TranscriptSegment["role"] =
      key === tutorKey || tutorKey.includes(key) || key.includes(tutorKey)
        ? "tutor"
        : key === studentKey || studentKey.includes(key) || key.includes(studentKey)
          ? "student"
          : "other";

    segments.push({
      index: segments.length,
      speaker,
      role,
      startSeconds: words[0]?.start_timestamp?.relative ?? 0,
      endSeconds: words[words.length - 1]?.end_timestamp?.relative ?? 0,
      text,
    });
  }

  // Consecutive turns by the same speaker read as one paragraph, which is how
  // a person would transcribe them.
  const merged: TranscriptSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && previous.speaker === segment.speaker && segment.startSeconds - previous.endSeconds < 2) {
      previous.text = `${previous.text} ${segment.text}`;
      previous.endSeconds = segment.endSeconds;
      continue;
    }
    merged.push({ ...segment, index: merged.length });
  }

  return merged.map((segment, index) => ({ ...segment, index }));
}
