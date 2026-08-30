/* ==========================================================================
   Recall.ai — types
   --------------------------------------------------------------------------
   Only the parts of Recall's API this portal actually uses. Kept narrow on
   purpose: a wide mirror of someone else's API is a maintenance burden that
   silently rots. Anything not modelled here is `unknown` and must be narrowed
   at the point of use.
   ========================================================================== */

export type RecallRegion =
  | "us-east-1"
  | "us-west-2"
  | "eu-central-1"
  | "ap-northeast-1";

export interface ScheduleBotInput {
  /** The Google Meet / Zoom / Teams URL the bot should join. */
  meetingUrl: string;
  /** Shown in the participant list. Must disclose what the participant is. */
  botName: string;
  /** ISO instant. Recall admits the bot a few minutes before this. */
  joinAt: string;
  /** Our lesson id, echoed back on every webhook for this bot. */
  lessonId: string;
}

export interface ScheduledBot {
  botId: string;
  status: string;
}

export interface RecallTranscriptWord {
  text: string;
  start_timestamp?: { relative?: number };
  end_timestamp?: { relative?: number };
}

export interface RecallTranscriptEntry {
  participant?: { id?: number; name?: string | null; is_host?: boolean };
  words?: RecallTranscriptWord[];
}

/** The envelope Recall posts to the webhook endpoint. */
export interface RecallWebhookEvent {
  event: string;
  data?: {
    bot_id?: string;
    /** Present on newer payload shapes. */
    bot?: { id?: string; metadata?: Record<string, unknown> };
    status?: { code?: string; created_at?: string; sub_code?: string | null; message?: string | null };
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  };
}
