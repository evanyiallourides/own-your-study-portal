"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/* Re-reads the instructions page while a buyer waits on their transfer, so the
   sheet flips to "received" by itself the moment the order is marked paid.

   Re-rendering the page, rather than polling a status endpoint, is the point:
   the page already re-reads the order from the database on every render, so
   there is one source of truth and no new public route to protect.

   Quiet by design — only while the tab is actually visible, and only for a
   couple of hours. A transfer takes a day or two; this is for the buyer who
   is still looking at the sheet, not a promise to watch forever. */

const EVERY_MS = 20_000;
const GIVE_UP_AFTER_MS = 2 * 60 * 60 * 1000;

export function StatusWatcher() {
  const router = useRouter();

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => {
      if (Date.now() - started > GIVE_UP_AFTER_MS) {
        clearInterval(id);
        return;
      }
      if (document.visibilityState !== "visible") return;
      router.refresh();
    }, EVERY_MS);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
