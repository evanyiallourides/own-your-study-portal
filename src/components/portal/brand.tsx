import Image from "next/image";
import Link from "next/link";

import { cx } from "@/components/ui/primitives";

/** The mark plus the wordmark, set in the display face — the same lockup the
 *  marketing site's nav uses, at portal scale. */
export function Brand({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cx("inline-flex items-center gap-2.5", className)}
      aria-label="Own Your Study Portal, home"
    >
      <Image
        src="/brand/mark.png"
        alt=""
        width={256}
        height={267}
        className="h-8 w-auto"
        priority
      />
      <span className="font-display text-[1.05rem] leading-none font-semibold tracking-[-0.02em]">
        <span className="text-ink-500">Own Your</span> <span className="text-ink">Study</span>
      </span>
    </Link>
  );
}
