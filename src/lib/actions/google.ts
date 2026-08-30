"use server";

import { revalidatePath } from "next/cache";

import { toActionError, type ActionResult } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/env";

/** Drop the stored connection and revoke it at Google. Only ever acts on the
 *  caller's own connection — there is no profile id parameter to get wrong. */
export async function disconnectGoogle(): Promise<ActionResult> {
  const session = await requireSession();

  if (isDemoMode()) {
    return { ok: false, error: "Demo mode has no Google connection to remove." };
  }

  try {
    const { disconnect } = await import("@/lib/google/connection");
    await disconnect(session.profile.id);
    revalidatePath("/profile");
    revalidatePath("/tutor/schedule");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
