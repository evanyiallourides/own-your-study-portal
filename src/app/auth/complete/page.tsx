"use client";

/* ==========================================================================
   Finishing a sign-in that arrived in the URL fragment
   --------------------------------------------------------------------------
   Supabase hands back a session in one of two shapes, and which one you get
   depends on who asked for the link:

     ?code=…            PKCE. The browser asked for the link itself, so it
                        holds the verifier. `/auth/callback` handles this
                        server-side and never needs this page.

     #access_token=…    Implicit. The link was minted server-side — every
                        invitation is, because `inviteUserByEmail` has no
                        browser to hold a verifier. The tokens come back in
                        the fragment.

   A fragment is never sent to the server. The route handler therefore sees a
   request with no code, which used to look identical to an expired link, and
   every invitation died on "That sign-in link is no longer valid."

   So this page exists: the one place where the fragment can be read at all.
   It sets the session from those tokens, which writes the auth cookies, then
   does a *full* navigation so the server sees them on the next request.
   ========================================================================== */

import { useEffect, useState } from "react";

import { Brand } from "@/components/portal/brand";
import { createClient } from "@/lib/supabase/client";

export default function AuthCompletePage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stale = "That sign-in link is no longer valid. Ask for a new one.";

    /* All of it inside one async path, so the page renders its working state
       first and every outcome — including the ones we can tell immediately —
       arrives the same way. */
    async function complete() {
      const raw = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
      const params = new URLSearchParams(raw);

      /* Supabase puts failures in the fragment too — an expired or
         already-used link arrives here rather than as a query error. */
      const described = params.get("error_description") ?? params.get("error");
      if (described) return described;

      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (!accessToken || !refreshToken) return stale;

      /* Take the tokens out of the address bar before doing anything with
         them: they are bearer credentials and should not survive in history
         or be readable over a shoulder. */
      window.history.replaceState(null, "", window.location.pathname);

      const { error: sessionError } = await createClient().auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (sessionError) return stale;

      /* A full navigation rather than a router push: the cookies were only
         just written, and the server has to read them on the next request to
         resolve the role and pick the right dashboard. */
      window.location.replace("/");
      return null;
    }

    complete()
      .then((message) => {
        if (!cancelled && message) setError(message);
      })
      .catch(() => {
        if (!cancelled) setError("Something went wrong finishing your sign-in.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <Brand href="/login" />
      {error ? (
        <>
          <p className="max-w-md text-ink-500">{error}</p>
          <a href="/login" className="font-semibold text-accent hover:underline">
            Back to sign in
          </a>
        </>
      ) : (
        <p className="text-ink-500">Signing you in…</p>
      )}
    </div>
  );
}
