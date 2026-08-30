"use client";

import { useClock } from "@/components/portal/clock";

/* ==========================================================================
   Countdown
   --------------------------------------------------------------------------
   The clock is an external mutable source, read through the shared hook rather
   than copied into state by an effect. It returns null on the server and
   during hydration, so nothing renders during SSR and there is no mismatch to
   explain away.
   ========================================================================== */

export function CountdownNote({
  iso,
  durationMinutes,
}: {
  iso: string;
  durationMinutes: number;
}) {
  const now = useClock();
  if (now === null) return null;

  const start = new Date(iso).getTime();
  const label = describe(start, start + durationMinutes * 60_000, now);
  if (!label) return null;

  return (
    <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-accent">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
      {label}
    </p>
  );
}

function describe(start: number, end: number, now: number): string | null {
  if (now >= start && now <= end) return "Happening now";
  if (now > end) return null;

  const minutes = Math.round((start - now) / 60_000);
  if (minutes < 60) return `Starts in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Starts in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `Starts in ${days} ${days === 1 ? "day" : "days"}`;
}
