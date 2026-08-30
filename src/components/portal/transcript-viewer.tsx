"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChevronDownIcon, CloseIcon, SearchIcon } from "@/components/ui/icons";
import { cx } from "@/components/ui/primitives";
import { formatOffset } from "@/lib/format";
import type { TranscriptSegment } from "@/lib/types";

/* ==========================================================================
   Transcript viewer
   --------------------------------------------------------------------------
   A conversation, not a table. Each turn is addressable as `#t-<index>`, so a
   lesson note can later link to the moment a thing was explained without this
   component changing — that is the whole reason segments carry a stable index
   rather than being positioned by time alone.
   ========================================================================== */

interface Match {
  segmentIndex: number;
  start: number;
  end: number;
}

function findMatches(segments: TranscriptSegment[], query: string): Match[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const matches: Match[] = [];
  for (const segment of segments) {
    const haystack = segment.text.toLowerCase();
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(q, from);
      if (at === -1) break;
      matches.push({ segmentIndex: segment.index, start: at, end: at + q.length });
      from = at + q.length;
    }
  }
  return matches;
}

function Highlighted({
  text,
  ranges,
  activeRange,
}: {
  text: string;
  ranges: Match[];
  activeRange: Match | null;
}) {
  if (ranges.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, i) => {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    const isActive =
      activeRange !== null &&
      activeRange.segmentIndex === range.segmentIndex &&
      activeRange.start === range.start;
    parts.push(
      <mark
        key={`${range.start}-${i}`}
        className={cx(
          "rounded-[3px] px-0.5",
          isActive ? "bg-accent text-white" : "bg-accent-wash text-ink",
        )}
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export function TranscriptViewer({
  segments,
  tutorName,
  studentName,
}: {
  segments: TranscriptSegment[];
  tutorName: string;
  studentName: string;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => findMatches(segments, query), [segments, query]);
  const activeMatch = matches[activeIndex] ?? null;

  const matchesBySegment = useMemo(() => {
    const map = new Map<number, Match[]>();
    for (const match of matches) {
      const list = map.get(match.segmentIndex) ?? [];
      list.push(match);
      map.set(match.segmentIndex, list);
    }
    return map;
  }, [matches]);

  // A new search starts at its first match. Adjusted during render so the
  // "1 of 12" counter is never briefly wrong.
  const [lastQuery, setLastQuery] = useState(query);
  if (query !== lastQuery) {
    setLastQuery(query);
    setActiveIndex(0);
  }

  const scrollToSegment = useCallback((segmentIndex: number) => {
    const node = document.getElementById(`t-${segmentIndex}`);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  useEffect(() => {
    if (activeMatch) scrollToSegment(activeMatch.segmentIndex);
  }, [activeMatch, scrollToSegment]);

  // A transcript arrived at by deep link should open at the right moment.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#t-")) return;
    const index = Number(hash.slice(3));
    if (Number.isFinite(index)) {
      // One frame's delay, so the list has laid out before we scroll into it.
      requestAnimationFrame(() => scrollToSegment(index));
    }
  }, [scrollToSegment]);

  const step = (delta: number) => {
    if (matches.length === 0) return;
    setActiveIndex((i) => (i + delta + matches.length) % matches.length);
  };

  return (
    <div>
      <div className="sticky top-14 z-20 -mx-1 mb-5 bg-paper/90 px-1 py-3 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  step(e.shiftKey ? -1 : 1);
                }
              }}
              placeholder="Search this transcript"
              aria-label="Search this transcript"
              className="field pl-10"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-300 hover:bg-paper-2 hover:text-ink"
              >
                <CloseIcon className="h-4 w-4" />
                <span className="sr-only">Clear search</span>
              </button>
            ) : null}
          </div>

          {query.trim().length >= 2 ? (
            <div className="flex items-center gap-1">
              <span
                className="mr-1 text-sm tabular-nums text-ink-500"
                role="status"
                aria-live="polite"
              >
                {matches.length === 0
                  ? "No matches"
                  : `${activeIndex + 1} of ${matches.length}`}
              </span>
              <button
                type="button"
                onClick={() => step(-1)}
                disabled={matches.length === 0}
                className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-rule bg-paper-3 text-ink-500 transition-colors hover:border-ink-300 hover:text-ink disabled:opacity-40"
              >
                <ChevronDownIcon className="h-4 w-4 rotate-180" />
                <span className="sr-only">Previous match</span>
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                disabled={matches.length === 0}
                className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-rule bg-paper-3 text-ink-500 transition-colors hover:border-ink-300 hover:text-ink disabled:opacity-40"
              >
                <ChevronDownIcon className="h-4 w-4" />
                <span className="sr-only">Next match</span>
              </button>
            </div>
          ) : null}
        </div>

        <p className="mt-2 text-xs text-ink-300">
          {segments.length} turns · {tutorName} and {studentName}
          {query.trim().length >= 2 ? " · press Enter to jump between matches" : ""}
        </p>
      </div>

      <div ref={containerRef} className="space-y-1">
        {segments.map((segment) => {
          const segmentMatches = matchesBySegment.get(segment.index) ?? [];
          const isActiveSegment = activeMatch?.segmentIndex === segment.index;
          const isTutor = segment.role === "tutor";

          return (
            <article
              key={segment.index}
              id={`t-${segment.index}`}
              className={cx(
                "scroll-mt-32 rounded-[10px] px-3 py-3 transition-colors duration-200 sm:px-4",
                isActiveSegment ? "bg-accent-wash/60" : "hover:bg-paper-2/70",
              )}
            >
              <div className="flex gap-3 sm:gap-4">
                {/* The vertical rule is the speaker cue. Colour alone would
                    fail for a colour-blind reader, so the name is always set
                    in full beside it. */}
                <span
                  aria-hidden
                  className={cx(
                    "mt-1 w-[3px] shrink-0 rounded-full",
                    isTutor ? "bg-accent" : "bg-ink-300",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                    <span
                      className={cx(
                        "text-sm font-semibold",
                        isTutor ? "text-accent" : "text-ink",
                      )}
                    >
                      {segment.speaker}
                    </span>
                    <a
                      href={`#t-${segment.index}`}
                      className="text-xs tabular-nums text-ink-300 hover:text-ink-500 hover:underline"
                      title="Link to this moment"
                    >
                      {formatOffset(segment.startSeconds)}
                    </a>
                  </p>
                  <p className="mt-1 leading-relaxed text-ink-700">
                    <Highlighted
                      text={segment.text}
                      ranges={segmentMatches}
                      activeRange={activeMatch}
                    />
                  </p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
