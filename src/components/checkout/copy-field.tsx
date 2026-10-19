"use client";

import { useRef, useState } from "react";

/* One line of the transfer details with a button that copies it. The thing a
   buyer does next is switch to their bank app and type these in, so every
   value they have to carry across is one tap. */

export function CopyField({
  label,
  value,
  copyValue,
  emphasis = false,
}: {
  label: string;
  /** What is shown — and, unless `copyValue` says otherwise, what is copied. */
  value: string;
  /** For when a bank's box wants less than the page shows: "620.00" for "€620". */
  copyValue?: string;
  emphasis?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  const done = () => {
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyValue ?? value);
      done();
      return;
    } catch {
      // The async Clipboard API can be refused — inside a frame, on an older
      // browser, or by a permission policy. Fall through to selecting the text.
    }
    const node = textRef.current;
    if (node) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      /* Selected, the legacy command can still copy it, and it works in some
         places the modern API does not. Where it does not either, the text is
         left selected so a long-press or Cmd-C finishes the job. */
      try {
        // It copies what is shown, so only when what is shown is what should
        // be copied — "€620" must not replace "620.00" on the clipboard.
        if ((copyValue === undefined || copyValue === value) && document.execCommand("copy")) done();
      } catch {
        // Nothing more to try.
      }
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">{label}</p>
        <span
          ref={textRef}
          className={
            emphasis
              ? "block break-words font-display text-xl font-semibold tracking-wide text-ink"
              : "block break-words text-sm text-ink"
          }
        >
          {value}
        </span>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="flex-none rounded-lg border border-rule bg-white px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-paper-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}
