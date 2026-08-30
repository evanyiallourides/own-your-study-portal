import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  GoogleApiError,
  emailFromIdToken,
  refreshAccessToken,
  revokeToken,
  type TokenSet,
} from "@/lib/google/oauth";

/* ==========================================================================
   The stored connection
   --------------------------------------------------------------------------
   Where a tutor's Google credentials live, and the only code that reads them.

   Everything here goes through the service-role client, because the token
   column is not readable through the API by anybody — there is no select
   policy on google_accounts at all. That is deliberate: a refresh token is a
   standing grant over somebody's calendar, and the blast radius of leaking one
   is larger than anything else in the database.

   Access tokens are cached with their expiry and refreshed only when spent, so
   a page that touches Google three times does not mint three tokens.
   ========================================================================== */

export interface GoogleConnection {
  profileId: string;
  email: string;
  calendarId: string;
  connectedAt: string;
  lastUsedAt: string | null;
  lastError: string | null;
}

interface AccountRow {
  profile_id: string;
  google_email: string;
  google_sub: string;
  refresh_token: string;
  access_token: string | null;
  access_expires_at: string | null;
  calendar_id: string;
  scope: string;
  connected_at: string;
  last_used_at: string | null;
  last_error: string | null;
}

function toConnection(row: AccountRow): GoogleConnection {
  return {
    profileId: row.profile_id,
    email: row.google_email,
    calendarId: row.calendar_id,
    connectedAt: row.connected_at,
    lastUsedAt: row.last_used_at,
    lastError: row.last_error,
  };
}

/** Status for display. Never returns a token. */
export async function getConnection(profileId: string): Promise<GoogleConnection | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("google_accounts")
    .select("*")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error || !data) return null;
  return toConnection(data as AccountRow);
}

/** Save a first consent. Upsert, because reconnecting is a normal thing to do
 *  and should replace the old grant rather than fail on the primary key. */
export async function saveConnection(profileId: string, tokens: TokenSet): Promise<void> {
  if (!tokens.refreshToken) {
    /* Google omits the refresh token when the account has approved this app
       before and prompt=consent was not honoured. Storing the row without one
       would produce a connection that works for an hour and then dies with a
       confusing error, so it is refused here instead. */
    throw new GoogleApiError(
      "Google did not return a refresh token. Remove the portal from your Google account permissions and connect again.",
      400,
      true,
    );
  }

  const identity = emailFromIdToken(tokens.idToken);

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("google_accounts").upsert(
    {
      profile_id: profileId,
      google_email: identity?.email ?? "unknown",
      google_sub: identity?.sub ?? "unknown",
      refresh_token: tokens.refreshToken,
      access_token: tokens.accessToken,
      access_expires_at: tokens.expiresAt.toISOString(),
      scope: tokens.scope,
      connected_at: new Date().toISOString(),
      last_error: null,
    },
    { onConflict: "profile_id" },
  );

  if (error) throw new Error(`Could not save the Google connection: ${error.message}`);
}

/**
 * An access token that is good right now.
 *
 * Returns the cached one while it lasts, refreshes when it does not, and
 * writes the new one back so the next request is free. A refresh that fails
 * with invalid_grant records the reason on the row: the tutor needs to
 * reconnect, and the interface should be able to say so without guessing.
 */
export async function getAccessToken(
  profileId: string,
): Promise<{ token: string; calendarId: string }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("google_accounts")
    .select("*")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error || !data) {
    throw new GoogleApiError("No Google account is connected for this person.", 404, true);
  }

  const row = data as AccountRow;

  if (row.access_token && row.access_expires_at && new Date(row.access_expires_at) > new Date()) {
    return { token: row.access_token, calendarId: row.calendar_id };
  }

  try {
    const refreshed = await refreshAccessToken(row.refresh_token);

    await admin
      .from("google_accounts")
      .update({
        access_token: refreshed.accessToken,
        access_expires_at: refreshed.expiresAt.toISOString(),
        last_used_at: new Date().toISOString(),
        last_error: null,
        /* Google occasionally rotates the refresh token. Keeping the old one
           after that would work until it did not. */
        ...(refreshed.refreshToken ? { refresh_token: refreshed.refreshToken } : {}),
      })
      .eq("profile_id", profileId);

    return { token: refreshed.accessToken, calendarId: row.calendar_id };
  } catch (cause) {
    const message =
      cause instanceof GoogleApiError && cause.needsReconnect
        ? "Google has revoked this connection. Reconnect to keep creating Meet links."
        : "Google could not be reached to refresh the connection.";

    await admin
      .from("google_accounts")
      .update({ last_error: message })
      .eq("profile_id", profileId);

    throw cause instanceof GoogleApiError ? cause : new GoogleApiError(message, 502);
  }
}

/** Note that the connection worked, so the status page can show something
 *  more useful than "connected at some point". */
export async function markUsed(profileId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin
    .from("google_accounts")
    .update({ last_used_at: new Date().toISOString(), last_error: null })
    .eq("profile_id", profileId);
}

/** Disconnect, and tell Google too. The database trigger takes care of marking
 *  the affected lessons as no longer managed by us. */
export async function disconnect(profileId: string): Promise<void> {
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("google_accounts")
    .select("refresh_token")
    .eq("profile_id", profileId)
    .maybeSingle();

  const token = (data as { refresh_token?: string } | null)?.refresh_token;
  if (token) await revokeToken(token);

  await admin.from("google_accounts").delete().eq("profile_id", profileId);
}
