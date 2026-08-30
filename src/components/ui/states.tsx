import type { ReactNode } from "react";

import { AlertIcon } from "@/components/ui/icons";
import { cx } from "@/components/ui/primitives";

/* ==========================================================================
   Empty, loading and error states
   --------------------------------------------------------------------------
   Every asynchronous screen gets all three. An empty table with a header row
   and nothing under it reads as a bug; a sentence explaining what will appear
   there reads as a product.
   ========================================================================== */

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center rounded-[14px] border border-dashed border-rule bg-paper-3/60 px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? <div className="mb-4 text-ink-300">{icon}</div> : null}
      <p className="font-display text-lg font-semibold text-ink">{title}</p>
      {description ? (
        <p className="mt-2 max-w-[46ch] text-sm leading-relaxed text-ink-500">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-[14px] border border-danger/25 bg-danger-wash px-5 py-4"
    >
      <div className="flex items-center gap-2 text-danger">
        <AlertIcon />
        <p className="font-semibold">{title}</p>
      </div>
      {description ? <p className="text-sm text-ink-700">{description}</p> : null}
      {action}
    </div>
  );
}

/* -- Skeletons -------------------------------------------------------------
   Shaped like the content they stand in for, so the layout does not jump when
   the real thing arrives.
   ------------------------------------------------------------------------ */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cx("animate-pulse rounded-[6px] bg-paper-2", className)}
    />
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-5 w-40" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
      <Skeleton className="h-24" />
    </div>
  );
}

export function CardSkeletonGrid({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-busy="true">
      <span className="sr-only">Loading</span>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-36" />
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-busy="true">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20" />
      ))}
    </div>
  );
}
