import { createHmac, timingSafeEqual } from "node:crypto";

/* ==========================================================================
   Webhook verification
   --------------------------------------------------------------------------
   Recall delivers webhooks through Svix, which signs each request over
   `${id}.${timestamp}.${body}` with an HMAC-SHA256 key. Verifying it needs the
   raw body — parsing before verifying would let a forged payload through on a
   whitespace difference — so the route reads text() first and hands it here.

   This fails closed. With no secret configured the endpoint rejects every
   request rather than accepting unsigned ones, because the alternative is an
   open endpoint that writes transcripts into student records.
   ========================================================================== */

export type VerificationResult =
  | { ok: true }
  | { ok: false; reason: string; status: 400 | 401 | 503 };

/** Svix tolerates five minutes of clock skew; so do we. */
const TOLERANCE_SECONDS = 5 * 60;

export function verifyWebhookSignature(
  rawBody: string,
  headers: Headers,
  secret: string | null,
): VerificationResult {
  if (!secret) {
    return {
      ok: false,
      reason: "RECALL_WEBHOOK_SECRET is not configured, so incoming webhooks cannot be verified.",
      status: 503,
    };
  }

  const id = headers.get("svix-id") ?? headers.get("webhook-id");
  const timestamp = headers.get("svix-timestamp") ?? headers.get("webhook-timestamp");
  const signatureHeader = headers.get("svix-signature") ?? headers.get("webhook-signature");

  if (!id || !timestamp || !signatureHeader) {
    return { ok: false, reason: "Missing signature headers.", status: 400 };
  }

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) {
    return { ok: false, reason: "Invalid timestamp.", status: 400 };
  }
  const skew = Math.abs(Math.floor(Date.now() / 1000) - sentAt);
  if (skew > TOLERANCE_SECONDS) {
    // Rejecting stale deliveries is what stops a captured request being
    // replayed later.
    return { ok: false, reason: "Timestamp outside the accepted window.", status: 400 };
  }

  // Svix secrets are base64 with a `whsec_` prefix.
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");

  // The header can carry several space-separated versioned signatures during
  // a key rotation; any one matching is a pass.
  const provided = signatureHeader
    .split(" ")
    .map((part) => part.split(",")[1] ?? part)
    .filter(Boolean);

  const expectedBuffer = Buffer.from(expected);
  const matched = provided.some((candidate) => {
    const candidateBuffer = Buffer.from(candidate);
    if (candidateBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(candidateBuffer, expectedBuffer);
  });

  return matched ? { ok: true } : { ok: false, reason: "Signature did not match.", status: 401 };
}

/** A stable id for the delivery, used as the idempotency key. Falls back to a
 *  hash of the body when the header is absent, so redelivery is still a no-op. */
export function deliveryId(rawBody: string, headers: Headers): string {
  const id = headers.get("svix-id") ?? headers.get("webhook-id");
  if (id) return id;
  return createHmac("sha256", "delivery-id").update(rawBody).digest("hex").slice(0, 40);
}
