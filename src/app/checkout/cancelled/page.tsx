import type { Metadata } from "next";

export const metadata: Metadata = { title: "Checkout cancelled" };

export default function CheckoutCancelledPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-display text-4xl font-semibold text-ink">Nothing was charged</h1>
      <p className="max-w-prose text-ink-500">
        You closed the payment page before finishing, so no money has moved and nothing has been
        booked. You can pick up where you left off whenever you like.
      </p>
      <div className="flex flex-wrap gap-3 pt-2">
        <a
          href="https://ownyourstudy.com"
          className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white hover:opacity-90"
        >
          Back to the site
        </a>
        <a
          href="mailto:hello@ownyourstudy.com"
          className="rounded-xl border border-rule px-5 py-3 text-sm font-semibold text-ink hover:bg-paper-2"
        >
          Ask us a question
        </a>
      </div>
    </div>
  );
}
