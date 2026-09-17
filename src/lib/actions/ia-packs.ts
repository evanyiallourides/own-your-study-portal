"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole } from "@/lib/auth/session";
import { toActionError, type ActionResult } from "@/lib/actions/result";
import { isDemoMode } from "@/lib/env";
import { installPack, removePack } from "@/lib/ia/pack-store";
import { INSTALLABLE_RUBRICS } from "@/lib/ia/rubrics";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AssessmentPack } from "@/lib/ia/packs";

/* ==========================================================================
   Installing official descriptors
   --------------------------------------------------------------------------
   Administrators only, at every layer: the role is checked here, the table is
   admin-only under RLS, and the page it is reached from is under /admin.

   The service-role client is used for the write because the same client reads
   these packs during a review — a student's review must be marked against
   descriptors the student cannot themselves read. One client, one table, two
   directions, and no path that puts licensed text in a browser.
   ========================================================================== */

const installSchema = z.object({
  rubricId: z.enum(INSTALLABLE_RUBRICS),
  pack: z.string().trim().min(2).max(400_000),
});

export interface InstallOutcome {
  problems: string[];
  checksum: string | null;
}

export async function installAssessmentPack(
  formData: FormData,
): Promise<ActionResult<InstallOutcome>> {
  const session = await requireRole("admin");

  if (isDemoMode()) {
    return { ok: false, error: "Demo mode has no database to install into." };
  }

  const parsed = installSchema.safeParse({
    rubricId: formData.get("rubricId"),
    pack: formData.get("pack"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Choose a marking model and paste the descriptors." };
  }

  let body: unknown;
  try {
    body = JSON.parse(parsed.data.pack);
  } catch (error) {
    return {
      ok: false,
      error: `That is not valid JSON: ${error instanceof Error ? error.message : "unparseable"}`,
    };
  }

  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "The pack should be a JSON object." };
  }

  const pack = body as AssessmentPack;

  /* The dropdown and the JSON must agree. They are two statements of the same
     fact, and installing Chemistry's descriptors under Biology's model is the
     one mistake here that would produce marks rather than an error. */
  if (pack.rubricId && pack.rubricId !== parsed.data.rubricId) {
    return {
      ok: false,
      error: `The JSON says "${pack.rubricId}" but you chose "${parsed.data.rubricId}". Fix whichever is wrong — installing them mismatched would mark one subject against another's descriptors.`,
    };
  }

  try {
    const result = await installPack(
      createSupabaseAdminClient(),
      { ...pack, rubricId: parsed.data.rubricId },
      session.profile.id,
    );

    revalidatePath("/admin/ia-reviews");
    return {
      ok: true,
      data: {
        problems: result.problems.map((p) => `${p.field}: ${p.detail}`),
        checksum: result.checksum,
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

const removeSchema = z.object({ rubricId: z.enum(INSTALLABLE_RUBRICS) });

/**
 * Take a set of descriptors out of service.
 *
 * Reviews already produced keep their recorded version and checksum. This
 * stops new marks; it does not retract marks already given, which would be
 * rewriting what a student was told after the fact.
 */
export async function removeAssessmentPack(
  input: z.input<typeof removeSchema>,
): Promise<ActionResult> {
  await requireRole("admin");
  if (isDemoMode()) return { ok: false, error: "Demo mode has no database." };

  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That is not a marking model." };

  try {
    await removePack(createSupabaseAdminClient(), parsed.data.rubricId);
    revalidatePath("/admin/ia-reviews");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
