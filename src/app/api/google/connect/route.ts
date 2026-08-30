import { NextResponse, type NextRequest } from "next/server";

import { getPortalSession } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/env";
import {
  OAUTH_STATE_COOKIE,
  consentUrl,
  createState,
  isGoogleConfigured,
} from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

/**
 * Start the Google consent flow.
 *
 * A GET that causes a redirect is the right shape here — it is the browser
 * navigating away, not a mutation — but the state cookie it sets is what makes
 * the returning callback trustworthy. Nothing is written to the database until
 * that cookie and the returned state agree.
 */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = new URL(request.url);

  const session = await getPortalSession();
  if (!session) return NextResponse.redirect(`${origin}/login`);

  /* Only the people who run lessons have a calendar worth connecting. A
     student's Google account is not something this product should ask for. */
  if (session.profile.role !== "tutor" && session.profile.role !== "admin") {
    return NextResponse.redirect(`${origin}/profile`);
  }

  if (isDemoMode()) {
    return NextResponse.redirect(
      `${origin}/profile?google=${encodeURIComponent("Demo mode cannot connect a real Google account.")}`,
    );
  }

  if (!isGoogleConfigured()) {
    return NextResponse.redirect(
      `${origin}/profile?google=${encodeURIComponent("Google is not configured on this deployment.")}`,
    );
  }

  const returnTo = searchParams.get("returnTo") ?? "/profile";
  const safeReturn = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/profile";

  const { state, nonce } = createState(safeReturn);

  const response = NextResponse.redirect(consentUrl(state, session.profile.email));
  response.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 600, // Ten minutes is longer than anyone takes to click "Allow".
  });
  return response;
}
