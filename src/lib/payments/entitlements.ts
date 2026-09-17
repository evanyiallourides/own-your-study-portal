import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/* ==========================================================================
   Applying what an order granted
   --------------------------------------------------------------------------
   The only path outside `setQuestionBankAccess` that writes
   `question_bank_access`. The question bank migration was written on the
   promise that a payment webhook would write that same table and nothing else
   would have to change; this is the code that keeps it.

   Everything here goes through `claim_orders_for_profile`, the SQL function, so
   the rule about renewals extending rather than resetting lives in exactly one
   place. Restating it in TypeScript would give two answers to one question.
   ========================================================================== */

type Db = SupabaseClient;

export interface ClaimResult {
  claimed: boolean;
  reason: string;
}

/**
 * Attach a paid order to a student, if we can work out who they are.
 *
 * Anonymous buyers are the normal case, not the exception: the marketing site
 * is static and the portal has no self-signup. An order nobody can be matched
 * to is not an error — it goes to the administrator's queue, and
 * `handle_new_user` will claim it by itself if that person is later invited.
 */
export async function claimOrderForBuyer(db: Db, email: string): Promise<ClaimResult> {
  const address = email.trim().toLowerCase();
  if (!address) return { claimed: false, reason: "The order carries no email." };

  const { data: profile, error } = await db
    .from("profiles")
    .select("id, role")
    .ilike("email", address)
    .maybeSingle();

  if (error) return { claimed: false, reason: `Could not look up the buyer: ${error.code}` };
  if (!profile) return { claimed: false, reason: "No portal account with that email yet." };
  if (profile.role !== "student") {
    return { claimed: false, reason: `That email belongs to a ${profile.role}, not a student.` };
  }

  const { data: claimed, error: rpcError } = await db.rpc("claim_orders_for_profile", {
    p_profile_id: profile.id,
  });

  if (rpcError) return { claimed: false, reason: `Could not attach the order: ${rpcError.code}` };
  return {
    claimed: (claimed ?? 0) > 0,
    reason: (claimed ?? 0) > 0 ? `Attached ${claimed} order(s).` : "Nothing left to attach.",
  };
}

/**
 * Take back what an order granted — a full refund, or an instalment plan that
 * ended short.
 *
 * Only ever touches access this order paid for. Somebody who also has twenty
 * pooled hours keeps their access through the hours rule, which is in SQL and
 * is none of this function's business.
 */
export async function revokeOrderEntitlement(db: Db, orderId: string): Promise<void> {
  await db
    .from("question_bank_access")
    .update({ granted: false, note: "Revoked: payment refunded or plan cancelled." })
    .eq("order_id", orderId);

  /* IA review credits come back too, but only the ones not yet spent — the
     rule lives in SQL so that "a refund does not claw back a review the
     student has already read" is stated once. Ignored on failure: a database
     that has not run the IA migration yet must not fail a refund. */
  await db.rpc("revoke_ia_credits_for_order", { p_order_id: orderId });
}

/** Tell every administrator something needs a human. */
export async function notifyAdmins(
  db: Db,
  kind: "payment_received" | "payment_failed" | "order_unmatched" | "ia_review_requested",
  title: string,
  body: string,
): Promise<void> {
  const { data: admins } = await db.from("profiles").select("id").eq("role", "admin");
  if (!admins?.length) return;

  await db.from("notifications").insert(
    admins.map((admin: { id: string }) => ({
      profile_id: admin.id,
      kind,
      title,
      body,
    })),
  );
}
