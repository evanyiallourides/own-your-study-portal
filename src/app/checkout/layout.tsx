import Link from "next/link";

import { Brand } from "@/components/portal/brand";

/* Checkout sits outside the (portal) route group: buyers have no account, so
   the authenticated shell — navigation, role switcher, notifications — would be
   both wrong and slightly alarming. */

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
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
          Payments are handled by Stripe. Card details never reach this site.
        </div>
      </footer>
    </div>
  );
}
