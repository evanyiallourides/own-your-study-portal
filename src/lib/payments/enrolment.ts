import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* ==========================================================================
   Turning a payment into a student
   --------------------------------------------------------------------------
   The person who pays is often not the person who learns. A parent buys twenty
   hours for their child; the card, the email and the name on the receipt are
   all the parent's. Attaching the purchase to the payer would put a child's
   lessons on their mother's account and give her the question bank licence.

   So checkout asks who the student is, and leaves it blank when they are the
   same person. This resolves the two into one answer, and creates the account
   when there is not one yet.
   ========================================================================== */

export interface StudentIdentity {
  email: string;
  firstName: string;
  lastName: string;
  /** True when the buyer named somebody else at checkout. */
  boughtForSomeoneElse: boolean;
}

/** Nothing clever — enough to reject a typo, not enough to reject a real address. */
export function looksLikeEmail(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed) && trimmed.length <= 254;
}

/** "Sophia Thompson" -> first and last. A single word is a first name. */
export function splitName(full: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

/**
 * Who the account should belong to.
 *
 * The student's details win when checkout collected them; the buyer's are the
 * fallback, which covers the common case of somebody buying for themselves.
 * A student email that does not parse is ignored rather than trusted — an
 * invitation sent to a typo goes to a stranger and never comes back.
 */
export function resolveStudent(input: {
  buyerEmail: string;
  buyerName: string | null;
  studentEmail: string | null;
  studentName: string | null;
}): StudentIdentity | null {
  const studentEmailValid = looksLikeEmail(input.studentEmail);
  const email = (studentEmailValid ? input.studentEmail! : input.buyerEmail).trim().toLowerCase();
  if (!looksLikeEmail(email)) return null;

  const named = input.studentName?.trim();
  const { firstName, lastName } = splitName(named || input.buyerName);

  return {
    email,
    firstName,
    lastName,
    boughtForSomeoneElse:
      studentEmailValid && input.studentEmail!.trim().toLowerCase() !== input.buyerEmail.trim().toLowerCase(),
  };
}

export type EnrolResult =
  | { status: "invited"; email: string }
  | { status: "exists"; email: string }
  | { status: "off" }
  | { status: "failed"; reason: string };

/**
 * Invite a student account for somebody who has paid and has none.
 *
 * An invitation rather than an account: Supabase emails a link that has to be
 * accepted from the buyer's own inbox, so a mistyped address cannot become a
 * usable account belonging to the wrong person. Accepting it fires
 * handle_new_user(), which builds the profile and the student row and calls
 * claim_orders_for_profile() — so the purchase is already there when they
 * arrive, without anything else running.
 */
export async function enrolPaidBuyer(
  db: SupabaseClient,
  student: StudentIdentity,
): Promise<EnrolResult> {
  const { data: settings } = await db
    .from("app_settings")
    .select("auto_invite_paid_buyers")
    .maybeSingle();

  if (settings?.auto_invite_paid_buyers !== true) return { status: "off" };
  if (!env.supabaseServiceRoleKey) {
    return { status: "failed", reason: "No service-role key, so no invitation can be sent." };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(student.email, {
    redirectTo: `${env.appUrl.replace(/\/$/, "")}/auth/callback`,
    data: {
      role: "student",
      first_name: student.firstName,
      last_name: student.lastName,
    },
  });

  if (error) {
    // Already registered is not a failure — it means somebody else created the
    // account between the payment and this call, and the claim will find it.
    if (/already been registered/i.test(error.message)) {
      return { status: "exists", email: student.email };
    }
    return { status: "failed", reason: error.message };
  }

  return { status: "invited", email: student.email };
}
