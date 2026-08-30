import Link from "next/link";

import { ClockIcon } from "@/components/ui/icons";
import { cx } from "@/components/ui/primitives";

/* ==========================================================================
   The tutor's day, in one line
   --------------------------------------------------------------------------
   A student opens the portal now and then to read something. A tutor opens it
   before teaching and again between lessons, to find out what is owed and how
   long they have got. Those are different jobs, and until now they were the
   same page with different words on it.

   So this is a strip rather than a heading: the four numbers that decide what
   a tutor does next, close enough together to take in at a glance, each one a
   link to the thing it is about.

   Deliberately not the StatCard grid the administrator's overview uses. That
   is a reporting surface — big display numerals, read occasionally, nothing to
   act on. This is a working one. If a tutor and an administrator open the
   portal and see the same furniture, neither page is doing its job.
   ========================================================================== */

export interface DayStat {
  label: string;
  /** The number, or a time like "14:00". Kept as a string so a time and a
   *  count can sit in the same row without one of them being a lie. */
  value: string;
  /** The line under it — a name, a subject, "nothing waiting". */
  detail?: string;
  href?: string;
  /** Draws attention only when there is something to attend to. */
  tone?: "default" | "warning" | "accent";
}

export function TutorDayBar({ stats }: { stats: DayStat[] }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-rule bg-paper-3">
      <div className="grid grid-cols-2 divide-rule sm:grid-cols-4 sm:divide-x">
        {stats.map((stat, index) => (
          <Segment key={stat.label} stat={stat} index={index} />
        ))}
      </div>
    </div>
  );
}

function Segment({ stat, index }: { stat: DayStat; index: number }) {
  const body = (
    <>
      <p className="eyebrow flex items-center gap-1.5">
        {index === 0 ? <ClockIcon className="h-3.5 w-3.5" /> : null}
        {stat.label}
      </p>
      <p
        className={cx(
          "mt-2 font-display text-2xl leading-none font-semibold tabular-nums",
          stat.tone === "warning" && "text-warning",
          stat.tone === "accent" && "text-accent",
          (!stat.tone || stat.tone === "default") && "text-ink",
        )}
      >
        {stat.value}
      </p>
      {stat.detail ? (
        <p className="mt-1.5 truncate text-sm text-ink-500">{stat.detail}</p>
      ) : null}
    </>
  );

  /* The hairlines only run between columns, so the two-column mobile layout
     needs its own rule under the first row rather than a border on every cell,
     which would draw a box around each number. */
  const cell = cx(
    "min-w-0 p-4 sm:p-5",
    index < 2 && "border-b border-rule sm:border-b-0",
    index % 2 === 1 && "border-l border-rule sm:border-l-0",
  );

  if (stat.href) {
    return (
      <Link href={stat.href} className={cx(cell, "transition-colors hover:bg-paper-2/60")}>
        {body}
      </Link>
    );
  }
  return <div className={cell}>{body}</div>;
}
