import { NextResponse, type NextRequest } from "next/server";

import { getPortalSession } from "@/lib/auth/session";
import { saveConnection } from "@/lib/google/connection";
import { OAUTH_STATE_COOKIE, exchangeCode, readState } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

/**
 * Where Google sends the tutor back.
 *
 * Three things have to line up before a token is stored: somebody is signed in
 * here, the state was signed by us, and the nonce inside it matches the cookie
 * set when the flow started. Checking only the first two would still let a
 * link crafted elsewhere finish a flow into this session — the cookie is what
 * ties the callback to the browser that began it.
 */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = new URL(request.url);

  const fail = (message: string, returnTo = "/profile") =>
    NextResponse.redirect(`${origin}${returnTo}?google=${encodeURIComponent(message)}`);

  const session = await getPortalSession();
  if (!session) return NextResponse.redirect(`${origin}/login`);

  // The person declined, or Google refused. Either way it is not an error to
  // shout about.
  const denied = searchParams.get("error");
  if (denied) return fail("Google Calendar was not connected.");

  const state = readState(searchParams.get("state"));
  const nonce = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  if (!state || !nonce || state.nonce !== nonce) {
    return fail("That connection attempt could not be verified. Please start again.");
  }

  const code = searchParams.get("code");
  if (!code) return fail("Google did not return an authorisation code.", state.returnTo);

  try {
    const tokens = await exchangeCode(code);
    await saveConnection(session.profile.id, tokens);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The Google connection could not be completed.";
    return fail(message, state.returnTo);
  }

  const response = NextResponse.redirect(
    `${origin}${state.returnTo}?google=${encodeURIComponent("Google Calendar connected.")}`,
  );
  // The nonce has done its job; leaving it around only widens the window.
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
