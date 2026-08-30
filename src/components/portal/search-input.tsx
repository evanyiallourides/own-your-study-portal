"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { CloseIcon, SearchIcon } from "@/components/ui/icons";

/**
 * Search is a URL parameter, filtered on the server. That keeps the result set
 * shareable and reloadable, and it means there is no client-side copy of the
 * data to go stale — which matters here, because half the reason a row is
 * missing from a list is that the reader is not allowed to see it.
 */
export function SearchInput({
  placeholder,
  paramName = "q",
  label,
}: {
  placeholder: string;
  paramName?: string;
  label: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initial = params.get(paramName) ?? "";
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A back/forward navigation should put the field back in step with the URL.
  // Adjusted during render, not in an effect: the field must never paint with
  // a value the URL disagrees with.
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setValue(initial);
  }

  const push = (next: string) => {
    const search = new URLSearchParams(params.toString());
    if (next.trim()) search.set(paramName, next.trim());
    else search.delete(paramName);
    const qs = search.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const onChange = (next: string) => {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push(next), 250);
  };

  return (
    <div className="relative w-full sm:max-w-sm">
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="field pl-10"
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            setValue("");
            push("");
          }}
          className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-300 hover:bg-paper-2 hover:text-ink"
        >
          <CloseIcon className="h-4 w-4" />
          <span className="sr-only">Clear search</span>
        </button>
      ) : null}
    </div>
  );
}
