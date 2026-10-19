"use client";

import { useEffect } from "react";

/* ==========================================================================
   The other end of the checkout sheet
   --------------------------------------------------------------------------
   ownyourstudy.com opens checkout in an iframe (assets/checkout-sheet.js on
   the marketing site). The sheet cannot see inside the frame, so this tells it
   what it needs to know: that the page loaded, how tall it is, and when the
   payment has landed.

   Messages carry no data — no order id, no amount, no email — only an event
   name and a height. That is deliberate: the parent is trusted to *display*
   a sheet, not to learn who is paying. The sheet, for its part, only listens
   to messages from this origin and from its own iframe.

   Outside a frame — someone opening ?embed=1 directly — all of this is a
   no-op, so the page still works as a page.
   ========================================================================== */

type BridgeEvent = "ready" | "height" | "paid" | "close";

function framed(): boolean {
  return typeof window !== "undefined" && window.parent !== window;
}

function post(type: BridgeEvent, extra?: Record<string, unknown>) {
  if (!framed()) return;
  /* Aim at the page that actually framed us where the browser says who that
     is (Chromium, Safari). Where it does not, "*" is acceptable only because
     of what these messages contain: nothing. */
  const target = window.location.ancestorOrigins?.[0] ?? "*";
  window.parent.postMessage({ source: "oys-checkout", type, ...extra }, target);
}

/**
 * Mounted once per framed page. Announces "ready", keeps the sheet's height in
 * step with the content, and sends any link that would leave checkout out to
 * a new tab — a frame that navigates to /login or the marketing site is
 * refused by both, and the buyer is left looking at an empty box.
 */
export function EmbedBridge() {
  useEffect(() => {
    if (!framed()) return;

    post("ready");

    const reportHeight = () => post("height", { height: Math.ceil(document.body.getBoundingClientRect().height) });
    reportHeight();
    const observer = new ResizeObserver(reportHeight);
    observer.observe(document.body);

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target) return;
      if (anchor.protocol === "mailto:" || anchor.protocol === "tel:") return;
      const stays = anchor.origin === window.location.origin && anchor.pathname.startsWith("/checkout/");
      if (stays) return;
      event.preventDefault();
      window.open(anchor.href, "_blank", "noopener,noreferrer");
    };
    document.addEventListener("click", onClick);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick);
    };
  }, []);

  return null;
}

/** Tells the sheet something happened — once, when this mounts. */
export function EmbedSignal({ type }: { type: Exclude<BridgeEvent, "ready" | "height"> }) {
  useEffect(() => {
    post(type);
  }, [type]);
  return null;
}

/** Closes the sheet; on a page opened directly, goes back to the site instead. */
export function EmbedCloseButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (framed()) post("close");
        else window.location.href = "https://ownyourstudy.com";
      }}
      className="underline underline-offset-2"
    >
      {children}
    </button>
  );
}
