import { NextResponse, type NextRequest } from "next/server";

import { DEMO_COOKIE } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/env";

/**
 * Demo only. Drops the demo session and returns to the account picker.
 *
 * Without this, the "Demo data" chip's link to /login simply bounced back to
 * the dashboard — /login redirects anyone already signed in — so there was no
 * way to change role without logging out first.
 */
export async function GET(request: NextRequest) {
  const { origin } = new URL(request.url);
  if (!isDemoMode()) {
    return NextResponse.redirect(`${origin}/`);
  }
  const response = NextResponse.redirect(`${origin}/login`);
  response.cookies.delete(DEMO_COOKIE);
  return response;
}
