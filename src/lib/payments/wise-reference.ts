import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/* ==========================================================================
   The reference a Wise buyer is asked to quote
   --------------------------------------------------------------------------
   Stripe knows which order a payment belongs to because the Checkout Session
   carries client_reference_id. A bank transfer carries nothing but whatever
   text the payer's own bank lets them type into a reference field, so an
   order paid through Wise is given a short one instead, at checkout time,
   before Wise has ever heard of it.

   Short and typeable on purpose: some local payment rails truncate or strip
   an unstructured reference field, so this stays well inside the tightest
   limits (UK Faster Payments references are commonly cut to 18 characters)
   and avoids characters a human is likely to mistype — no 0/O, no 1/I/L.
   ========================================================================== */

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O/1/I/L
const SUFFIX_LENGTH = 6;
const MAX_ATTEMPTS = 10;

function randomSuffix(): string {
  let suffix = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return suffix;
}

/**
 * A reference checked against every existing order before it is handed out.
 * Retries on the — very unlikely — chance of a collision rather than trusting
 * randomness alone: the database's unique index is the real guarantee, this
 * only avoids sending a checkout attempt into a write that would fail on it.
 */
export async function generatePaymentReference(db: SupabaseClient): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = `OYS-${randomSuffix()}`;
    const { data } = await db
      .from("orders")
      .select("id")
      .eq("payment_reference", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  throw new Error("Could not generate a unique payment reference.");
}

/** The Wise order a reference points to, or null if nothing matches. */
export async function findOrderByReference(
  db: SupabaseClient,
  reference: string,
): Promise<{ id: string } | null> {
  const { data } = await db
    .from("orders")
    .select("id")
    .eq("provider", "wise")
    .eq("payment_reference", reference.trim().toUpperCase())
    .maybeSingle();
  return data ?? null;
}
