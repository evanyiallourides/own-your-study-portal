import "server-only";

import { createVerify } from "node:crypto";

import { env } from "@/lib/env";

/* ==========================================================================
   The Wise client
   --------------------------------------------------------------------------
   Wise's API is plain REST/JSON with no official Node SDK worth depending on
   the way Stripe's is, so this is a thin authenticated-fetch wrapper rather
   than a generated client. It plays the same role stripeClient() does in
   stripe.ts: a missing token produces one clear error rather than an
   undefined reaching a network call, and nothing talks to Wise at import
   time.

   Some Wise endpoints require Strong Customer Authentication — a request
   signed with a private key registered separately from this API token.
   Confirm which calls this integration actually needs that for, against
   Wise's current developer docs, before relying on this wrapper for them —
   nothing here signs a request.
   ========================================================================== */

const LIVE_BASE_URL = "https://api.transferwise.com";
const SANDBOX_BASE_URL = "https://api.sandbox.transferwise.tech";

export function wiseConfigured(): boolean {
  return Boolean(env.wiseApiToken);
}

export async function wiseFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = env.wiseApiToken;
  if (!token) {
    throw new Error("WISE_API_TOKEN is not set; this call should not have been reached.");
  }

  const base = env.wiseSandbox ? SANDBOX_BASE_URL : LIVE_BASE_URL;
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Wise API ${response.status} on ${path}: ${body.slice(0, 200)}`);
  }

  return (await response.json()) as T;
}

/**
 * Verifies a webhook delivery against Wise's own public key: an RSA
 * signature of the raw request body, SHA-256, sent base64-encoded in the
 * `X-Signature-SHA256` header. The body must be the exact bytes Wise sent —
 * verifying a re-serialised copy of the parsed JSON would pass or fail on
 * whitespace Wise never signed.
 *
 * Returns false rather than throwing on anything malformed — a webhook route
 * should refuse a bad delivery the same way it refuses a missing one, not
 * 500 on it.
 */
export function verifyWiseWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const publicKey = env.wiseWebhookPublicKey;
  if (!publicKey || !signatureHeader) return false;

  try {
    return createVerify("RSA-SHA256").update(rawBody).verify(publicKey, signatureHeader, "base64");
  } catch {
    return false;
  }
}
