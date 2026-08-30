"use client";

import { useSyncExternalStore } from "react";

/* ==========================================================================
   A shared clock
   --------------------------------------------------------------------------
   Anything that changes with the passage of time — a countdown, a link that
   becomes live — reads the clock through here rather than copying Date.now()
   into state with an effect.

   The snapshot is bucketed to 30 seconds so the value is stable between ticks
   and React is not asked to re-render on every millisecond. The server
   snapshot is null, which is the useful part: a component can render the
   state the server computed, hydrate against that same null, and only then
   start refining it. No mismatch, and no blank frame while it waits.
   ========================================================================== */

export const TICK_MS = 30_000;

function subscribe(onChange: () => void): () => void {
  const timer = setInterval(onChange, TICK_MS);
  return () => clearInterval(timer);
}

const getSnapshot = () => Math.floor(Date.now() / TICK_MS);
const getServerSnapshot = () => null;

/** Milliseconds since the epoch, rounded down to the tick — or null on the
 *  server and during hydration. */
export function useClock(): number | null {
  const tick = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return tick === null ? null : tick * TICK_MS;
}
