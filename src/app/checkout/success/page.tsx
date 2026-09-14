import type { Metadata } from "next";
import Link from "next/link";

import { stripeClient, stripeConfigured } from "@/lib/payments/stripe";

/* ==========================================================================
   /checkout/success
   --------------------------------------------------------------------------
   Every figure on this page comes from retrieving the session from Stripe, not
   from the query string — the only thing taken from the URL is the id to look
   up. A success page that believes its own query string is a success page
   anyone can screenshot.

   It also has to be honest about buy-now-pay-later. Klarna and Zip return the
   buyer here before the money has settled, so a session that is still unpaid
   says so rather than claiming a payment that has not happened.
   ========================================================================== */

export const metadata: Metadata = { title: "Thank you" };
export const dynamic = "force-dynamic";

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  const sessionId = typeof query.session_id === "string" ? query.session_id : null;

  let email: string | null = null;
  /* Checkout asks who the student is when it is not the buyer. Saying the
     address back is what stops somebody watching the wrong inbox. */
  let studentEmail: string | null = null;
  let settled = false;
  let pending = false;
  let amount: string | null = null;

  if (sessionId && stripeConfigured()) {
    try {
      const session = await stripeClient().checkout.sessions.retrieve(sessionId);
      email = session.customer_details?.email ?? session.customer_email ?? null;
      const given = session.custom_fields?.find((f) => f.key === "student_email")?.text?.value?.trim();
      if (given && given.toLowerCase() !== (email ?? "").toLowerCase()) studentEmail = given;
      settled = session.payment_status === "paid" || session.payment_status === "no_payment_required";
      pending = session.payment_status === "unpaid";
      if (session.amount_total !== null && session.currency) {
        amount = new Intl.NumberFormat("en", {
          style: "currency",
          currency: session.currency.toUpperCase(),
          maximumFractionDigits: 0,
        }).format(session.amount_total / 100);
      }
    } catch {
      // A bad or expired id is not worth an error page; the order still exists
      // and the webhook is what actually records it.
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-4xl font-semibold text-ink">
        {pending ? "Almost there" : "Thank you"}
      </h1>

      {pending ? (
        <p className="max-w-prose text-ink-500">
          Your payment provider is still settling this. Nothing more is needed from you — we will
          email {email ? <strong className="text-ink">{email}</strong> : "you"} once it clears,
          usually within a few minutes.
        </p>
      ) : (
        <p className="max-w-prose text-ink-500">
          {amount ? `That's ${amount} received. ` : ""}
          {studentEmail ? (
            <>
              We are setting up the portal for{" "}
              <strong className="text-ink">{studentEmail}</strong> and everything you have just
              bought will be on it. Watch for an email &mdash; it has the link to get in.
            </>
          ) : (
            <>
              We will email {email ? <strong className="text-ink">{email}</strong> : "you"} a link
              to the student portal, where your lessons, notes and materials live. Anything you
              have just bought will already be there when you arrive.
            </>
          )}
        </p>
      )}

      {settled && (
        <p className="max-w-prose text-ink-500">
          A receipt is on its way from Stripe. If there is already a portal account for{" "}
          {studentEmail ?? email ?? "that address"}, this is on it now &mdash; just sign in.
        </p>
      )}

      <div className="flex flex-wrap gap-3 pt-2">
        <Link
          href="/login"
          className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white hover:opacity-90"
        >
          Go to the portal
        </Link>
        <a
          href="https://ownyourstudy.com"
          className="rounded-xl border border-rule px-5 py-3 text-sm font-semibold text-ink hover:bg-paper-2"
        >
          Back to the site
        </a>
      </div>
    </div>
  );
}
