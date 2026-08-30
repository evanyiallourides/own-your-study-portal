import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import type { StatusTone } from "@/lib/status";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* -- Section heading ------------------------------------------------------
   Tag above heading, never tag-left/heading-right — the same rule the
   marketing site follows.
   ------------------------------------------------------------------------ */
export function SectionHead({
  eyebrow,
  title,
  description,
  action,
  as: Heading = "h2",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
        <Heading className={Heading === "h1" ? "text-3xl sm:text-4xl" : "text-xl sm:text-2xl"}>
          {title}
        </Heading>
        {description ? (
          <p className="mt-2 max-w-[62ch] text-ink-500">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* -- Buttons -------------------------------------------------------------- */

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-full border-2 border-transparent px-4 py-2 text-sm font-semibold whitespace-nowrap transition-[background-color,color,border-color,transform] duration-150 disabled:cursor-not-allowed disabled:opacity-45";

const BUTTON_VARIANTS = {
  solid: "bg-accent border-accent text-white hover:bg-accent-soft hover:border-accent-soft active:translate-y-px",
  outline: "border-rule bg-paper-3 text-ink hover:border-ink-300 hover:bg-paper-2 active:translate-y-px",
  ghost: "border-transparent text-ink-500 hover:bg-paper-2 hover:text-ink",
  danger: "border-danger/25 bg-danger-wash text-danger hover:border-danger/50",
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;

export function buttonClass(variant: ButtonVariant = "outline", extra?: string): string {
  return cx(BUTTON_BASE, BUTTON_VARIANTS[variant], extra);
}

export function Button({
  variant = "outline",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return <button {...props} className={buttonClass(variant, className)} />;
}

export function ButtonLink({
  variant = "outline",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link {...props} className={buttonClass(variant, className)} />;
}

/* -- Status badge ---------------------------------------------------------
   Deliberately quiet: a hairline border and a wash, never a saturated pill.
   ------------------------------------------------------------------------ */

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "border-rule bg-paper-2 text-ink-500",
  info: "border-info/20 bg-info-wash text-info",
  accent: "border-accent/25 bg-accent-wash text-accent",
  warning: "border-warning/25 bg-warning-wash text-warning",
  success: "border-success/20 bg-success-wash text-success",
  danger: "border-danger/25 bg-danger-wash text-danger",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* -- Card ----------------------------------------------------------------- */

export function Card({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "li";
}) {
  return <Tag className={cx("card p-5 sm:p-6", className)}>{children}</Tag>;
}

/* -- Avatar --------------------------------------------------------------- */

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-wash font-semibold text-accent"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {letters || "?"}
    </span>
  );
}

/* -- Definition list used across the notes and detail panels --------------- */

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="eyebrow mb-1">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

/* -- A bulleted list that reads as prose rather than as data --------------- */

export function NoteList({ items, tone }: { items: string[]; tone?: "accent" | "warning" }) {
  if (items.length === 0) return null;
  const marker =
    tone === "accent" ? "bg-accent" : tone === "warning" ? "bg-warning" : "bg-ink-300";
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={`${i}-${item.slice(0, 24)}`} className="flex gap-3">
          <span className={cx("mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full", marker)} aria-hidden />
          <span className="text-ink-700">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/* -- Hairline divider ------------------------------------------------------ */

export function Rule({ className }: { className?: string }) {
  return <hr className={cx("border-0 border-t border-rule", className)} />;
}
