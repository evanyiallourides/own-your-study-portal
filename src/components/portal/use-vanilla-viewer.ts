"use client";

import { useEffect } from "react";

/* ==========================================================================
   Mounting a vanilla viewer inside React
   --------------------------------------------------------------------------
   The question bank and mock paper viewers are plain scripts that render
   themselves into an empty div. They are seven hundred lines of filtering,
   marking and progress logic shared with the marketing site, and reimplementing
   them in React to avoid this file would be far worse than this file.

   They were mounted with `<script src defer />` in the JSX, on the reasoning
   that a deferred script needs no orchestration and should not depend on
   hydration. Both halves of that turned out to be wrong here, in two different
   ways, and the shelf was empty either way:

     Arriving by a fresh page load, the script ran and populated the shelf
     before React hydrated. React then found children it had not rendered,
     reported a hydration mismatch, and did what that error says it does —
     regenerated the subtree, discarding the viewer's markup.

     Arriving by a link inside the portal — which is how anyone actually gets
     there — React had already hoisted and loaded the script on an earlier
     page and does not execute a hoisted script twice. Nothing called the boot
     function at all, so nothing was ever rendered.

   So the script is loaded here instead of in the markup, and the boot function
   is called on every mount rather than only when the file first executes.
   Loading is shared: the tag is created once per src and later mounts reuse it,
   which is the one thing React's hoisting did get right.

   The container must also carry `dangerouslySetInnerHTML={{ __html: "" }}`.
   That is not cargo cult — it is what tells React the children are not its to
   diff, so a later re-render anywhere above cannot wipe the viewer out again.
   ========================================================================== */

type BootFn = () => void;

export function useVanillaViewer(src: string, bootName: string): void {
  useEffect(() => {
    let cancelled = false;

    const boot = () => {
      if (cancelled) return;
      const fn = (window as unknown as Record<string, unknown>)[bootName];
      // Re-booting is safe: each boot re-reads the container's data attributes
      // and re-renders into it, which is also what makes a remount work.
      if (typeof fn === "function") (fn as BootFn)();
    };

    const selector = `script[data-vanilla-viewer="${CSS.escape(src)}"]`;
    const existing = document.querySelector<HTMLScriptElement>(selector);

    if (existing) {
      if (existing.dataset.ready === "true") boot();
      else existing.addEventListener("load", boot, { once: true });
      return () => {
        cancelled = true;
        existing.removeEventListener("load", boot);
      };
    }

    const tag = document.createElement("script");
    tag.src = src;
    tag.async = false;
    tag.dataset.vanillaViewer = src;
    tag.addEventListener(
      "load",
      () => {
        tag.dataset.ready = "true";
        boot();
      },
      { once: true },
    );
    document.head.appendChild(tag);

    return () => {
      cancelled = true;
    };
  }, [src, bootName]);
}
