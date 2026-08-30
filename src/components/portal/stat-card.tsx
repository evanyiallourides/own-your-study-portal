import Link from "next/link";

import { cx } from "@/components/ui/primitives";

/** A number and what it means. No sparkline, no percentage-change badge —
 *  there is no baseline to compare against yet and inventing one would be
 *  decoration pretending to be data. */
export function StatCard({
  label,
  value,
  detail,
  href,
  tone,
}: {
  label: string;
  value: number | string;
  detail?: string;
  href?: string;
  tone?: "default" | "warning";
}) {
  const body = (
    <>
      <p className="eyebrow">{label}</p>
      <p
        className={cx(
          "mt-3 font-display text-4xl leading-none font-semibold tabular-nums",
          tone === "warning" && value !== 0 ? "text-warning" : "text-ink",
        )}
      >
        {value}
      </p>
      {detail ? <p className="mt-2 text-sm text-ink-500">{detail}</p> : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="card card-interactive block p-5">
        {body}
      </Link>
    );
  }
  return <div className="card p-5">{body}</div>;
}
