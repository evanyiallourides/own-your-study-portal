"use client";

import { useEffect } from "react";

/* ==========================================================================
   Booting the vanilla viewers, from somewhere that is actually reachable
   --------------------------------------------------------------------------
   The question bank and mock paper viewers are plain scripts that draw
   themselves into an empty div. Getting them to run inside the App Router took
   three attempts, and the reason this one lives in the layout rather than
   beside the containers is worth writing down, because the obvious place does
   not work:

     A `<script src defer />` in the page markup ran before hydration on a
     fresh load, so React found children it had not rendered, called it a
     mismatch and regenerated the subtree — throwing the viewer's markup away.
     Following a link inside the portal it did not run at all, because React
     had already hoisted the script on an earlier page and does not execute a
     hoisted script twice.

     Moving it into a useEffect beside the container fixed the second case and
     roughly half of the first. The half is the point: `(portal)/loading.tsx`
     puts every page behind a Suspense boundary, so whether the page ships in
     the shell or streams in afterwards varies per request — two consecutive
     renders of the same URL differ, one with `<!--$?-->` and a fallback and
     one with `<!--$-->` and the content. When it streams late, the layout
     hydrates but the page subtree's effects never run, and the shelf is empty
     with no error to show for it.

   The layout always hydrates — that is why links keep working on exactly the
   loads where the shelf stayed blank. So the boot lives here, watching for a
   container to appear rather than being told when one has.

   The invariant: if a viewer's container is on the page and empty, the viewer
   has not drawn into it, so load its script and boot it. True on first paint,
   true after a client-side navigation, true when React rebuilds the element,
   and true when the content arrives late.
   ========================================================================== */

interface Viewer {
  /** Containers the viewer draws into; the shelf and the single-item view. */
  ids: readonly string[];
  src: string;
  /** The global the script exposes, which re-reads config and redraws. */
  boot: string;
}

const VIEWERS: readonly Viewer[] = [
  { ids: ["qb-shelf", "qb-root"], src: "/question-bank/qbank.js", boot: "qbBoot" },
  { ids: ["pp-shelf", "pp-root"], src: "/question-bank/papers.js", boot: "ppBoot" },
];

/** How long a boot may be in flight before it is assumed to have failed. */
const BOOT_GRACE_MS = 4_000;
/** A viewer whose fetch keeps failing must not become an unbounded retry loop. */
const MAX_BOOTS = 8;

export function ViewerHost() {
  useEffect(() => {
    let stopped = false;
    const state = new Map<string, { target: Element | null; at: number; boots: number }>();

    const load = (v: Viewer): HTMLScriptElement => {
      const selector = `script[data-vanilla-viewer="${CSS.escape(v.src)}"]`;
      const found = document.querySelector<HTMLScriptElement>(selector);
      if (found) return found;

      const tag = document.createElement("script");
      tag.src = v.src;
      tag.async = false;
      tag.dataset.vanillaViewer = v.src;
      tag.addEventListener("load", () => {
        tag.dataset.ready = "true";
        ensure();
      }, { once: true });
      document.head.appendChild(tag);
      return tag;
    };

    const ensure = () => {
      if (stopped) return;

      for (const v of VIEWERS) {
        const target = v.ids
          .map((id) => document.getElementById(id))
          .find((el): el is HTMLElement => el !== null);

        // Not on this page. Forget what we knew, so returning to it boots again.
        if (!target) {
          state.delete(v.src);
          continue;
        }

        const tag = load(v);
        if (tag.dataset.ready !== "true") continue;

        const seen = state.get(v.src) ?? { target: null, at: 0, boots: 0 };
        if (seen.boots >= MAX_BOOTS) continue;
        // Drawn into, and still the element we drew into.
        if (target === seen.target && target.children.length > 0) continue;
        // Same element, still empty — the fetch may simply be in flight.
        if (target === seen.target && Date.now() - seen.at < BOOT_GRACE_MS) continue;

        const fn = (window as unknown as Record<string, unknown>)[v.boot];
        if (typeof fn !== "function") continue;

        state.set(v.src, { target, at: Date.now(), boots: seen.boots + 1 });
        (fn as () => void)();
      }
    };

    ensure();

    // Catches React swapping the element, and content that arrives late.
    const observer = new MutationObserver(ensure);
    observer.observe(document.body, { childList: true, subtree: true });
    // Catches a boot that quietly drew nothing, which the observer cannot see.
    const retry = window.setInterval(ensure, 1_000);

    return () => {
      stopped = true;
      observer.disconnect();
      window.clearInterval(retry);
    };
  }, []);

  return null;
}
