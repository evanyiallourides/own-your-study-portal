import Link from "next/link";

import { EmbedBridge } from "@/components/checkout/embed-bridge";
import { Brand } from "@/components/portal/brand";

/* ==========================================================================
   Checkout chrome
   --------------------------------------------------------------------------
   Checkout sits outside the (portal) route group: buyers have no account, so
   the authenticated shell — navigation, role switcher, notifications — would
   be both wrong and slightly alarming.

   It used to live in a layout. It is a component now because a layout cannot
   read the query string, and whether to draw the chrome depends on one: opened
   in the marketing site's sheet (?embed=1) the sheet already supplies the
   title bar and the close button, and a second logo and footer inside it would
   be noise.
   ========================================================================== */

export function CheckoutShell({ embed, children }: { embed: boolean; children: React.ReactNode }) {
  if (embed) {
    /* No min-height: the sheet sizes its frame to this content, and a page
       that insists on filling the viewport would never report getting smaller. */
    return (
      <div className="bg-paper px-5 py-6 sm:px-7">
        <EmbedBridge />
        {children}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Brand />
          <Link href="/login" className="text-sm text-ink-500 underline-offset-4 hover:underline">
            Already have an account?
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">{children}</main>
      <footer className="border-t border-rule">
        <div className="mx-auto max-w-3xl px-6 py-6 text-xs text-ink-500">
          Australian-dollar payments are handled by Stripe; card details never reach this site.
          Other currencies are paid by direct bank transfer via Wise.
        </div>
      </footer>
    </div>
  );
}
