"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import { toActionError, type ActionResult } from "@/lib/actions/result";

/* ==========================================================================
   Orders
   --------------------------------------------------------------------------
   Kept out of admin.ts, which is already long, and because these are about
   money rather than about people.

   Each one re-checks the role on the server. A server action is a public HTTP
   endpoint wearing a function's clothes, and the fact that the only button
   calling it sits on an admin page is not a check.
   ========================================================================== */

/*
 * Identifiers are checked for being present and sane, not for being UUIDs.
 *
 * Whether a row exists is the repository's question, and whether the caller may
 * touch it is RLS's — both of which run anyway. Insisting on a UUID here adds
 * no safety on top of those and breaks demo mode outright, where the seeded ids
 * are readable strings like "s-sophia". Demo mode is how this screen gets
 * looked at, so a check that only fails there is a check that only costs.
 */
const id = z.string().trim().min(1).max(64);

const linkSchema = z.object({
  orderId: id,
  studentId: id,
});

/**
 * Attach a payment to the student it was for.
 *
 * The queue this clears is the one the marketing site creates: somebody buys
 * from a static page with no account, so there is nobody to give it to until an
 * administrator says who. Applying what the order granted is the repository's
 * job, so the rule about renewals extending rather than resetting stays in one
 * place.
 */
export async function linkOrderToStudent(
  input: z.input<typeof linkSchema>,
): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That was not a valid order or student." };

  try {
    const repo = await getRepository();
    await repo.linkOrderToStudent(parsed.data.orderId, parsed.data.studentId);
    revalidatePath("/admin/orders");
    revalidatePath(`/admin/students/${parsed.data.studentId}`);
    revalidatePath("/student/question-banks");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

const unlinkSchema = z.object({ orderId: id });

/**
 * Detach a payment linked to the wrong person.
 *
 * Deliberately does not revoke anything. The student may also have earned
 * access through pooled hours, and taking it away here would be guessing at
 * which of the two reasons applied.
 */
export async function unlinkOrder(input: z.input<typeof unlinkSchema>): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = unlinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That was not a valid order." };

  try {
    const repo = await getRepository();
    await repo.unlinkOrder(parsed.data.orderId);
    revalidatePath("/admin/orders");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
