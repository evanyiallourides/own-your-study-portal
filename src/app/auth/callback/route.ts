import { NextResponse, type NextRequest } from "next/server";

import { HOME_FOR_ROLE } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where a magic link or an invitation lands. Exchanges the one-time code for a
 * session cookie, then sends the user to the dashboard their role belongs to.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const errorDescription = searchParams.get("error_description");

  if (isDemoMode()) {
    return NextResponse.redirect(`${origin}/login`);
  }

  if (errorDescription) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(errorDescription)}`);
  }

  /* No code is not the same as a bad link. Server-minted links — every
     invitation is one — come back with the session in the URL fragment
     instead, and a fragment never reaches the server. Hand those to the one
     place that can read it; the browser carries the fragment across this
     redirect because the new location has none of its own. */
  if (!code) {
    return NextResponse.redirect(`${origin}/auth/complete`);
  }

  const db = await createSupabaseServerClient();
  const { error } = await db.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("That sign-in link has expired. Ask for a new one.")}`,
    );
  }

  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const { data: profile } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const role = (profile?.role ?? "student") as keyof typeof HOME_FOR_ROLE;
  return NextResponse.redirect(`${origin}${HOME_FOR_ROLE[role]}`);
}
