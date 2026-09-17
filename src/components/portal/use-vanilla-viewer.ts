"use client";

import { useEffect } from "react";

/* ==========================================================================
   Mounting a vanilla viewer inside React
   --------------------------------------------------------------------------
   The question bank and mock paper viewers are plain scripts that draw
   themselves into an empty div. They are seven hundred lines of filtering,
   marking and progress logic shared with the marketing site; reimplementing
   them in React to avoid this file would be far worse than this file.

   Three separate things broke a `<script src defer />` in the markup, and each
   one on its own was enough to leave a paying student staring at an empty
   shelf:

     1. On a fresh load the script ran before React hydrated. React then found
        children it had not rendered, called it a hydration mismatch, and did
        what that error says — regenerated the subtree, discarding the markup.

     2. Following a link inside the portal — how anyone actually arrives —
        React had already hoisted and loaded the script on an earlier page, and
        it does not execute a hoisted script twice. Nothing called boot at all.

     3. Worst, because it is intermittent: this portal has a hydration mismatch
        on every page, so React discards the server DOM and rebuilds it. That
        rebuild makes a *new* container element. Booting once on mount is not
        enough — the element booted into gets thrown away afterwards, and no
        effect re-runs to notice, so the shelf is populated or empty depending
        on which finished first.

   Hence the observer. The invariant it maintains is simply: if the container
   is on the page and empty, the viewer has not drawn into it yet, so boot.
   That is true whichever of the above just happened, and stays true if React
   replaces the element again later. Fixing the underlying mismatch would let
   this go back to a single boot on mount; until then, do not weaken it to one.
   ========================================================================== */

type BootFn = () => void;

/** Time a boot is allowed to be in flight before it is assumed to have failed. */
const BOOT_GRACE_MS = 3_000;
/** A failing fetch must not become an unbounded retry loop. */
const MAX_BOOTS = 6;

export function useVanillaViewer(src: string, bootName: string, containerId: string): void {
  useEffect(() => {
    let stopped = false;
    let lastTarget: Element | null = null;
    let lastBootAt = 0;
    let boots = 0;

    const scriptReady = (tag: HTMLScriptElement | null) => tag?.dataset.ready === "true";

    const ensure = () => {
      if (stopped || boots >= MAX_BOOTS) return;
      const tag = document.querySelector<HTMLScriptElement>(selector);
      if (!scriptReady(tag)) return;

      const target = document.getElementById(containerId);
      if (!target) return;

      // Drawn into, and still the element we drew into: nothing to do.
      if (target === lastTarget && target.children.length > 0) return;
      // Same element, still empty, but the fetch may simply be in flight.
      if (target === lastTarget && Date.now() - lastBootAt < BOOT_GRACE_MS) return;

      const fn = (window as unknown as Record<string, unknown>)[bootName];
      if (typeof fn !== "function") return;

      lastTarget = target;
      lastBootAt = Date.now();
      boots += 1;
      // Re-reads the container's data attributes and redraws, which is what
      // makes booting again after a remount or a rebuild the right answer.
      (fn as BootFn)();
    };

    const selector = `script[data-vanilla-viewer="${CSS.escape(src)}"]`;
    let tag = document.querySelector<HTMLScriptElement>(selector);

    if (!tag) {
      tag = document.createElement("script");
      tag.src = src;
      tag.async = false;
      tag.dataset.vanillaViewer = src;
      tag.addEventListener(
        "load",
        () => {
          tag!.dataset.ready = "true";
          ensure();
        },
        { once: true },
      );
      document.head.appendChild(tag);
    } else if (scriptReady(tag)) {
      ensure();
    } else {
      tag.addEventListener("load", ensure, { once: true });
    }

    const observer = new MutationObserver(ensure);
    observer.observe(document.body, { childList: true, subtree: true });

    // The observer sees React replace the container, but not a boot that
    // silently produced nothing; this covers the latter without polling on.
    const retry = window.setInterval(ensure, 1_000);

    return () => {
      stopped = true;
      observer.disconnect();
      window.clearInterval(retry);
      tag?.removeEventListener("load", ensure);
    };
  }, [src, bootName, containerId]);
}
