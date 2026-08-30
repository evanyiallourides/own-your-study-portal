"use client";

import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";

/** Browser client. Carries the anon key only — every read it makes is subject
 *  to Row Level Security, which is where the real authorisation lives. */
export function createClient() {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
}
