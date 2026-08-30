"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import { CheckIcon } from "@/components/ui/icons";
import { cx } from "@/components/ui/primitives";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { setHomeworkCompleted } from "@/lib/actions/homework";
import type { HomeworkItem } from "@/lib/types";

/* ==========================================================================
   Homework
   --------------------------------------------------------------------------
   A checklist, not a task manager. Items are created when a tutor publishes a
   lesson; the only thing a student can change is whether one is done. Due
   dates are shown when a tutor has set one and simply omitted when not, rather
   than inventing a deadline.
   ========================================================================== */

export function HomeworkList({
  items,
  emptyTitle = "No homework outstanding",
  emptyDescription = "When your tutor publishes a lesson, anything they set will appear here.",
  readOnly = false,
  /** Pre-formatted on the server so the list renders identically either side
   *  of hydration. */
  dueLabels = {},
  lessonHrefBase = "/student/lessons",
}: {
  items: HomeworkItem[];
  emptyTitle?: string;
  emptyDescription?: string;
  readOnly?: boolean;
  dueLabels?: Record<string, string>;
  lessonHrefBase?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  const toggle = (item: HomeworkItem) => {
    const next = !(optimistic[item.id] ?? item.completed);
    setOptimistic((prev) => ({ ...prev, [item.id]: next }));
    setError(null);
    startTransition(async () => {
      const result = await setHomeworkCompleted({ homeworkId: item.id, completed: next });
      if (!result.ok) {
        setOptimistic((prev) => ({ ...prev, [item.id]: !next }));
        setError(result.error);
      }
    });
  };

  return (
    <div className="space-y-3">
      {error ? <ErrorState title="Could not update that" description={error} /> : null}
      <ul className="space-y-2.5">
        {items.map((item) => {
          const done = optimistic[item.id] ?? item.completed;
          return (
            <li
              key={item.id}
              className={cx(
                "card flex items-start gap-3 p-4 transition-opacity",
                done && "opacity-65",
                pending && "cursor-progress",
              )}
            >
              {readOnly ? (
                <span
                  aria-hidden
                  className={cx(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border",
                    done ? "border-success bg-success text-white" : "border-rule bg-paper-3",
                  )}
                >
                  {done ? <CheckIcon className="h-3.5 w-3.5" /> : null}
                </span>
              ) : (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={done}
                  onClick={() => toggle(item)}
                  className={cx(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                    done
                      ? "border-success bg-success text-white"
                      : "border-rule bg-paper-3 hover:border-ink-300",
                  )}
                >
                  {done ? <CheckIcon className="h-3.5 w-3.5" /> : null}
                  <span className="sr-only">
                    {done ? "Mark as not done" : "Mark as done"}: {item.description}
                  </span>
                </button>
              )}

              <div className="min-w-0 flex-1">
                <p className={cx("text-ink", done && "line-through decoration-ink-300")}>
                  {item.description}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-300">
                  {item.subject ? <span>{item.subject.displayName}</span> : null}
                  {item.lessonTitle ? (
                    <>
                      <span aria-hidden>·</span>
                      <Link
                        href={`${lessonHrefBase}/${item.lessonId}`}
                        className="hover:text-ink-500 hover:underline"
                      >
                        {item.lessonTitle}
                      </Link>
                    </>
                  ) : null}
                  {dueLabels[item.id] ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className={cx(!done && "font-semibold text-warning")}>
                        {dueLabels[item.id]}
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
