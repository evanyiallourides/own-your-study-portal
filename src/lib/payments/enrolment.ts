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

   When the buyer names somebody else they are asked one more thing: whether
   they are that student's parent or guardian. A yes earns them an account of
   their own and a link to the child, which is what the parent dashboard reads.
   A no does not: somebody paying for an adult friend's tuition has bought
   lessons, not a standing view of how they are getting on. The buyer asserts
   the relationship because nobody else is in a position to — and an
   administrator can undo it on the student's page.
   ========================================================================== */

export interface StudentIdentity {
  email: string;
  firstName: string;
  lastName: string;
  /** True when the buyer named somebody else at checkout. */
  boughtForSomeoneElse: boolean;
}

/**
 * The buyer, when they told us they are the student's parent or guardian.
 *
 * Only ever produced alongside a student who is somebody else: a buyer who is
 * the student is not their own parent.
 */
export interface ParentIdentity {
  email: string;
  firstName: string;
  lastName: string;
  /** The student they bought for, lower-cased, as recorded on the order. */
  studentEmail: string;
}

/** Nothing clever — enough to reject a typo, not enough to reject a real address. */
export function looksLikeEmail(value: string | null | undefined): value is string {
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

/**
 * The buyer as a parent, when they said they are one.
 *
 * Three things all have to hold, and each rules out a case that would
 * otherwise hand somebody a child's records:
 *
 *   · they ticked the box — an unanswered question is not a yes;
 *   · they named a student who is somebody else — nobody parents themselves;
 *   · their own address parses — an invitation to a typo reaches a stranger.
 *
 * The student's identity is resolved first and passed in, so the two answers
 * cannot disagree about which address the child has.
 */
export function resolveParent(input: {
  buyerEmail: string;
  buyerName: string | null;
  isGuardian: boolean;
  student: StudentIdentity | null;
}): ParentIdentity | null {
  if (!input.isGuardian) return null;
  if (!input.student?.boughtForSomeoneElse) return null;

  const email = input.buyerEmail.trim().toLowerCase();
  if (!looksLikeEmail(email)) return null;
  if (email === input.student.email) return null;

  const { firstName, lastName } = splitName(input.buyerName);
  return { email, firstName, lastName, studentEmail: input.student.email };
}

/**
 * How the guardian question came back from checkout.
 *
 * Stripe hands every custom field over as a string, and an unanswered optional
 * field simply is not there. Anything that is not an explicit yes is a no — the
 * safe direction for a question whose yes grants access to a child's records.
 */
export function readGuardianAnswer(value: string | null | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "yes";
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
  return invite(db, student, "student");
}

/**
 * Invite the buyer as a parent of the student they bought for.
 *
 * Deliberately the same machinery and the same setting as the student's
 * invitation: they are two halves of one event, and a deployment that has
 * turned automatic enrolment off should not quietly keep creating half of it.
 *
 * Accepting this builds the profile and the `parents` row. The link to the
 * child is made separately, by `link_parent_for_profile()` in the database,
 * because whichever of the two accepts second is the one that can make it.
 */
export async function enrolPaidParent(
  db: SupabaseClient,
  parent: ParentIdentity,
): Promise<EnrolResult> {
  return invite(db, parent, "parent");
}

async function invite(
  db: SupabaseClient,
  person: { email: string; firstName: string; lastName: string },
  role: "student" | "parent",
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
  const { error } = await admin.auth.admin.inviteUserByEmail(person.email, {
    redirectTo: `${env.appUrl.replace(/\/$/, "")}/auth/callback`,
    data: {
      role,
      first_name: person.firstName,
      last_name: person.lastName,
    },
  });

  if (error) {
    // Already registered is not a failure — it means somebody else created the
    // account between the payment and this call, and the claim will find it.
    if (/already been registered/i.test(error.message)) {
      return { status: "exists", email: person.email };
    }
    return { status: "failed", reason: error.message };
  }

  return { status: "invited", email: person.email };
}
