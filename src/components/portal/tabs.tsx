"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/components/ui/primitives";

export interface TabDef {
  href: string;
  label: string;
  /** Rendered after the label — a count, or a small dot for "has content". */
  hint?: string;
  disabled?: boolean;
}

/**
 * Tabs are real links to real routes rather than local state, so a student can
 * send someone "the transcript tab" and it opens there. It also means each tab
 * gets its own loading boundary.
 */
export function Tabs({ tabs, ariaLabel }: { tabs: TabDef[]; ariaLabel: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label={ariaLabel} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-rule">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          if (tab.disabled) {
            return (
              <li key={tab.href}>
                <span
                  aria-disabled="true"
                  className="inline-flex cursor-not-allowed items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-ink-300"
                >
                  {tab.label}
                </span>
              </li>
            );
          }
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "border-accent text-ink"
                    : "border-transparent text-ink-500 hover:border-rule hover:text-ink",
                )}
              >
                {tab.label}
                {tab.hint ? (
                  <span
                    className={cx(
                      "rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                      active ? "bg-accent-wash text-accent" : "bg-paper-2 text-ink-300",
                    )}
                  >
                    {tab.hint}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
