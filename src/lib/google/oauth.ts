import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

/* ==========================================================================
   Google OAuth
   --------------------------------------------------------------------------
   A tutor connects their own Google account once; from then on the portal can
   put lessons in their calendar and mint a real Meet link for each one.

   Two decisions shape this file.

   The portal asks for the narrowest scope that does the job —
   calendar.events, not calendar — so a connection can create and update the
   events it made and cannot read the rest of somebody's diary. `openid email`
   is added only so the connection can be shown back as an address rather than
   an opaque id, which is how a person tells whether they connected the right
   account.

   The state parameter is signed and matched against a cookie. Without that,
   anyone can send a tutor a link that finishes an OAuth flow into an attacker's
   Google account, and the tutor's lessons quietly start appearing in somebody
   else's calendar.
   ========================================================================== */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
] as const;

export const OAUTH_STATE_COOKIE = "oys_google_oauth";

export class GoogleNotConfiguredError extends Error {
  constructor() {
    super(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set, so Google Calendar cannot be connected. Meeting links can still be pasted in by hand.",
    );
    this.name = "GoogleNotConfiguredError";
  }
}

export class GoogleApiError extends Error {
  readonly status: number;
  /** True when Google is telling us the grant is gone — the tutor revoked
   *  access, or changed their password. Reconnecting is the only fix, so this
   *  is worth distinguishing from a transient failure. */
  readonly needsReconnect: boolean;

  constructor(message: string, status: number, needsReconnect = false) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
    this.needsReconnect = needsReconnect;
  }
}

export function isGoogleConfigured(): boolean {
  return Boolean(env.googleClientId && env.googleClientSecret);
}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = env.googleClientId;
  const clientSecret = env.googleClientSecret;
  if (!clientId || !clientSecret) throw new GoogleNotConfiguredError();
  return { clientId, clientSecret };
}

export function redirectUri(): string {
  return `${env.appUrl.replace(/\/+$/, "")}/api/google/callback`;
}

/* -- state ---------------------------------------------------------------- */

/* Signed with the service-role key rather than a key of its own. It is the
   one secret guaranteed to exist wherever this code can run, it never leaves
   the server, and rotating it invalidates in-flight OAuth attempts — which is
   the correct thing for it to do. */
function stateSecret(): string {
  return env.supabaseServiceRoleKey ?? env.googleClientSecret ?? "own-your-study";
}

export interface OAuthState {
  nonce: string;
  /** Where to send the person once the connection is made. */
  returnTo: string;
}

export function createState(returnTo: string): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("hex");
  const payload = Buffer.from(JSON.stringify({ nonce, returnTo } satisfies OAuthState)).toString(
    "base64url",
  );
  const signature = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return { state: `${payload}.${signature}`, nonce };
}

/** Returns null for anything that was not signed by us. */
export function readState(state: string | null | undefined): OAuthState | null {
  if (!state) return null;
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;

  const expected = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as OAuthState;
    if (typeof parsed.nonce !== "string" || typeof parsed.returnTo !== "string") return null;
    /* Only same-origin paths, so a signed state cannot be turned into an open
       redirect if one ever leaks. */
    if (!parsed.returnTo.startsWith("/") || parsed.returnTo.startsWith("//")) return null;
    return parsed;
  } catch {
    return null;
  }
}

/* -- the flow ------------------------------------------------------------- */

export function consentUrl(state: string, loginHint?: string): string {
  const { clientId } = credentials();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    /* Both are needed to be handed a refresh token reliably. Without
       prompt=consent, a Google account that has approved this app before is
       sent back with an access token only, and the connection silently cannot
       outlive the hour. */
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  if (loginHint) params.set("login_hint", loginHint);

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface TokenSet {
  accessToken: string;
  /** Only present on the first consent. Absent on refresh. */
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
  idToken: string | null;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    /* invalid_grant is Google's way of saying the refresh token is dead. It is
       not retryable and the person has to reconnect, so it is surfaced as its
       own thing rather than as a generic 400. */
    const needsReconnect = text.includes("invalid_grant");
    throw new GoogleApiError(
      `Google rejected the token request (${response.status}): ${text.slice(0, 300)}`,
      response.status,
      needsReconnect,
    );
  }

  const json = JSON.parse(text) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    id_token?: string;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    /* A minute is taken off the lifetime so a token is never used in the
       second it expires — the request would fail for a reason that looks like
       a permissions problem and is not. */
    expiresAt: new Date(Date.now() + (json.expires_in - 60) * 1000),
    scope: json.scope ?? "",
    idToken: json.id_token ?? null,
  };
}

export async function exchangeCode(code: string): Promise<TokenSet> {
  const { clientId, clientSecret } = credentials();
  return tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const { clientId, clientSecret } = credentials();
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
}

/** Tell Google to forget us. Best effort: a failure here still means the
 *  portal should drop its copy of the token. */
export async function revokeToken(token: string): Promise<void> {
  await fetch(REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
    cache: "no-store",
  }).catch(() => undefined);
}

/** The email out of the id token. Not verified cryptographically, because it
 *  came straight from Google's token endpoint over TLS and is used only as a
 *  label — never as an authorisation decision. */
export function emailFromIdToken(idToken: string | null): { email: string; sub: string } | null {
  if (!idToken) return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      email?: string;
      sub?: string;
    };
    if (!claims.email || !claims.sub) return null;
    return { email: claims.email, sub: claims.sub };
  } catch {
    return null;
  }
}
