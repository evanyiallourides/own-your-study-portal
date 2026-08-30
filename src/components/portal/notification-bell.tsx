"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { BellIcon } from "@/components/ui/icons";
import { cx } from "@/components/ui/primitives";
import type { Notification } from "@/lib/types";

/**
 * V1 notifications are records, not infrastructure: no push, no email, no
 * websocket. The list is rendered from what the page already loaded, which is
 * enough to tell a tutor a draft is waiting without building a delivery
 * system that would then need operating.
 */
export function NotificationBell({ notifications }: { notifications: Notification[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = notifications.filter((n) => !n.readAt).length;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-paper-2 hover:text-ink"
      >
        <BellIcon />
        <span className="sr-only">
          {unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        </span>
        {unread > 0 ? (
          <span
            aria-hidden
            className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white"
          >
            {unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-[14px] border border-rule bg-paper-3 shadow-md">
          <p className="border-b border-rule px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-300">
            Notifications
          </p>
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-500">
              Nothing yet. You will be told here when lesson notes are ready.
            </p>
          ) : (
            <ul className="max-h-[22rem] divide-y divide-rule overflow-y-auto scroll-quiet">
              {notifications.map((n) => {
                const body = (
                  <>
                    <p
                      className={cx(
                        "text-sm leading-snug",
                        n.readAt ? "text-ink-500" : "font-semibold text-ink",
                      )}
                    >
                      {n.title}
                    </p>
                    {n.body ? <p className="mt-1 text-xs text-ink-500">{n.body}</p> : null}
                  </>
                );
                return (
                  <li key={n.id}>
                    {n.lessonId ? (
                      <Link
                        href={`/lessons/${n.lessonId}`}
                        onClick={() => setOpen(false)}
                        className="block px-4 py-3 transition-colors hover:bg-paper-2"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="px-4 py-3">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
