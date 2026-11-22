import "server-only";

import { env } from "@/lib/env";

/* ==========================================================================
   Sending an email
   --------------------------------------------------------------------------
   One function, over Resend's HTTP API, with no SDK: the whole of what is
   needed is a single authenticated POST, and a dependency for that would be
   more to keep patched than the call is worth.

   Two promises, because the callers are in the middle of taking someone's
   money:

     · It never throws. A receipt that fails to send must not fail the order it
       is a receipt for, so every failure — no key, a network error, Resend
       refusing — comes back as a value for the caller to log.
     · It is safe to call twice. An idempotency key makes Resend drop the
       second send of the same email, so a retried webhook or a double click
       cannot put two receipts in somebody's inbox.

   With no RESEND_API_KEY it does nothing, quietly. That is what lets the code
   ship before the key exists, and keeps demo mode and local development from
   needing one.
   ========================================================================== */

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Resend ignores a repeat of the same key for 24 hours. */
  idempotencyKey?: string;
}

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; skipped: boolean; reason: string };

const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 8_000;

export function emailConfigured(): boolean {
  return env.resendApiKey !== null;
}

export async function sendEmail(email: Email): Promise<SendResult> {
  const key = env.resendApiKey;
  if (!key) return { ok: false, skipped: true, reason: "RESEND_API_KEY is not set." };

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(email.idempotencyKey ? { "Idempotency-Key": email.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: env.emailFrom,
        to: [email.to],
        reply_to: env.emailReplyTo,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, skipped: false, reason: `Resend answered ${response.status}: ${body.slice(0, 200)}` };
    }

    const json = (await response.json().catch(() => null)) as { id?: unknown } | null;
    return { ok: true, id: typeof json?.id === "string" ? json.id : null };
  } catch (cause) {
    return {
      ok: false,
      skipped: false,
      reason: cause instanceof Error ? cause.message : "The email could not be sent.",
    };
  }
}
