import "server-only";

import { isDemoMode } from "@/lib/env";
import { getConnection } from "@/lib/google/connection";
import { isGoogleConfigured } from "@/lib/google/oauth";

/* ==========================================================================
   Is Google usable, and by whom
   --------------------------------------------------------------------------
   Pages ask this rather than assembling it themselves, so every screen gives
   the same answer and none of them has to guess which of the three ways this
   can be unavailable applies: the deployment has no Google credentials, the
   portal is in demo mode, or this particular person has simply not connected
   their calendar yet. They need different sentences.
   ========================================================================== */

export interface GoogleState {
  /** The deployment can do Google at all. */
  available: boolean;
  /** This person has connected an account. */
  connected: boolean;
  /** Which account, so they can tell whether it is the right one. */
  email: string | null;
  /** The last thing that went wrong with the connection, if anything. */
  error: string | null;
  /** Why it cannot be used, when it cannot. Null when everything is fine. */
  blocker: string | null;
}

const UNAVAILABLE = (blocker: string): GoogleState => ({
  available: false,
  connected: false,
  email: null,
  error: null,
  blocker,
});

export async function googleStateFor(profileId: string | null): Promise<GoogleState> {
  if (isDemoMode()) {
    return UNAVAILABLE("Demo mode cannot connect a real Google account.");
  }
  if (!isGoogleConfigured()) {
    return UNAVAILABLE(
      "Google is not configured on this deployment. Meeting links are pasted in by hand.",
    );
  }
  if (!profileId) return UNAVAILABLE("Not signed in.");

  /* A failure to read the connection is reported as "not connected" rather
     than thrown. This runs on pages whose actual job is something else, and a
     Google hiccup should not take a scheduling page down with it. */
  const connection = await getConnection(profileId).catch(() => null);

  return {
    available: true,
    connected: connection !== null,
    email: connection?.email ?? null,
    error: connection?.lastError ?? null,
    blocker: connection ? null : "No Google account is connected yet.",
  };
}
