import "server-only";

import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role client. Bypasses Row Level Security entirely, so it is confined
 * to code paths that have no user to act as: the Recall webhook, the analysis
 * pipeline, and admin invitations. Never import this into a component.
 */
export function createSupabaseAdminClient() {
  const key = env.supabaseServiceRoleKey;
  if (!env.supabaseUrl || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL are required for this operation.",
    );
  }
  return createClient(env.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
