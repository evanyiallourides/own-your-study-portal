"use client";

import { useEffect } from "react";

import { VideoIcon } from "@/components/ui/icons";

/* ==========================================================================
   Opening the meeting
   --------------------------------------------------------------------------
   Next's own redirect() cannot send a browser to another origin with a real
   3xx from a server component — it emits a meta refresh with a one-second
   delay, which on a button labelled "Join now" is a second of blank page at
   the worst possible moment. So the navigation happens here instead, as the
   first thing that runs after paint.

   location.replace rather than assign: the person came from the lesson page
   and should go back to the lesson page, not to this doorway, which would
   immediately push them out to the meeting again.
   ========================================================================== */

export function OpeningMeeting({ url, label }: { url: string; label: string }) {
  useEffect(() => {
    window.location.replace(url);
  }, [url]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-5 py-24 text-center">
      {/* Scripting off, or the replace blocked: the meta refresh still gets
          there, and the link below works regardless. */}
      <noscript>
        <meta httpEquiv="refresh" content={`0;url=${url}`} />
      </noscript>

      <span className="flex size-12 items-center justify-center rounded-full bg-accent-wash text-accent">
        <VideoIcon />
      </span>

      <p className="font-display text-xl font-semibold">Opening {label}…</p>

      <a href={url} className="text-sm font-medium text-accent underline">
        Continue to the meeting
      </a>
    </div>
  );
}
