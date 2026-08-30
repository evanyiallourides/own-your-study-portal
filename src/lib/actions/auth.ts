"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { DEMO_COOKIE, HOME_FOR_ROLE } from "@/lib/auth/session";
import { demoState } from "@/lib/data/demo-store";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signOut(): Promise<void> {
  if (isDemoMode()) {
    (await cookies()).delete(DEMO_COOKIE);
  } else {
    const db = await createSupabaseServerClient();
    await db.auth.signOut();
  }
  redirect("/login");
}

/** Demo-only. Picks which of the fixed demo people you are looking as. There
 *  is no password because there is no account — the dataset is fiction and the
 *  UI says so on every page. */
export async function signInAsDemoUser(profileId: string): Promise<void> {
  if (!isDemoMode()) throw new Error("Demo sign-in is not available.");

  const profile = demoState.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error("Unknown demo account.");

  (await cookies()).set(DEMO_COOKIE, profile.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 12,
  });

  redirect(HOME_FOR_ROLE[profile.role]);
}
