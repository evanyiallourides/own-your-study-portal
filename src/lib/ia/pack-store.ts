import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  checksumOf,
  validatePack,
  type AssessmentPack,
  type PackLoader,
  type PackProblem,
} from "@/lib/ia/packs";
import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* ==========================================================================
   Where installed descriptor packs actually live
   --------------------------------------------------------------------------
   `packs.ts` defines what a pack is and refuses to accept an incomplete one.
   This is the half that talks to the database, kept separate so the rules can
   be tested with a plain object and no Supabase.

   Three deliberate choices:

     · Reads go through the SERVICE ROLE. The table is admin-only under RLS,
       and the marking service runs for a student — who must never be able to
       read licensed descriptor text through the API, but whose review must
       still be marked against it. Service role here, admin-only policy there,
       and no path that hands the text to a browser.

     · Demo mode always returns nothing. A portal with no Supabase credentials
       has no packs, so demo reviews are feedback-only — which is exactly what
       a deployment with no descriptors should do, and means the demo shows the
       honest behaviour rather than a fabricated one.

     · Nothing is cached across requests. A pack is a few kilobytes read once
       per review, and the failure mode of caching it — an administrator
       replaces a pack and reviews keep coming out under the old one until the
       Worker recycles — is precisely the kind of silent version skew the
       checksum on every review exists to make visible.
   ========================================================================== */

export function packLoader(): PackLoader {
  // No database, no packs. Stated as its own branch rather than left to a
  // thrown error, because "feedback only" is a correct answer here and an
  // exception in the middle of a review is not.
  if (isDemoMode() || !canReachDatabase()) {
    return { load: async () => null };
  }

  const db = createSupabaseAdminClient();
  return {
    async load(rubricId: string): Promise<AssessmentPack | null> {
      const { data, error } = await db
        .from("ia_assessment_packs")
        .select("rubric_id, version, source, checksum, body, installed_at")
        .eq("rubric_id", rubricId)
        .maybeSingle();

      if (error || !data) return null;

      const row = data as {
        rubric_id: string;
        version: string;
        source: string;
        checksum: string;
        body: Record<string, unknown>;
        installed_at: string;
      };

      const pack: AssessmentPack = {
        ...(row.body as unknown as AssessmentPack),
        rubricId: row.rubric_id,
        version: row.version,
        source: row.source,
        checksum: row.checksum,
        installedAt: row.installed_at,
      };

      /* Validated on the way out as well as on the way in. A pack installed
         before a criterion id changed would otherwise keep marking against a
         model it no longer covers, and the first sign of it would be a mark
         nobody could explain. */
      return validatePack(pack).ok ? pack : null;
    },
  };
}

function canReachDatabase(): boolean {
  try {
    createSupabaseAdminClient();
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------------------
   Installing
   --------------------------------------------------------------------------
   An administrator pastes the descriptors for one model. It is validated
   before it is stored, so a pack that would mark four fifths of an exploration
   never reaches the table — the failure is reported to the person installing
   it, who can still fix it, rather than to a student six weeks later.
   -------------------------------------------------------------------------- */

export interface InstallResult {
  ok: boolean;
  problems: PackProblem[];
  checksum: string | null;
}

export async function installPack(
  db: SupabaseClient,
  pack: AssessmentPack,
  installedBy: string,
): Promise<InstallResult> {
  const validation = validatePack(pack);
  if (!validation.ok) {
    return { ok: false, problems: validation.problems, checksum: null };
  }

  const checksum = await checksumOf(pack);

  const { error } = await db.from("ia_assessment_packs").upsert(
    {
      rubric_id: pack.rubricId,
      version: pack.version.trim(),
      source: pack.source?.trim() || "Not recorded",
      checksum,
      // The descriptors themselves. Stored without the identifying columns
      // that sit beside them, so there is one answer to "which version is
      // this?" rather than two that can disagree.
      body: {
        shared: pack.shared,
        byLevel: pack.byLevel ?? null,
        generalGuidance: pack.generalGuidance ?? [],
        bestFitGuidance: pack.bestFitGuidance ?? [],
      },
      installed_by: installedBy,
    },
    { onConflict: "rubric_id" },
  );

  if (error) {
    return {
      ok: false,
      checksum: null,
      problems: [{ field: "database", detail: error.message }],
    };
  }

  return { ok: true, problems: [], checksum };
}

/**
 * Take a pack out of service.
 *
 * Reviews produced under it keep their recorded version and checksum, which is
 * the point of recording them: removing the pack stops new marks, and does not
 * retract or rewrite marks already given.
 */
export async function removePack(db: SupabaseClient, rubricId: string): Promise<void> {
  await db.from("ia_assessment_packs").delete().eq("rubric_id", rubricId);
}
