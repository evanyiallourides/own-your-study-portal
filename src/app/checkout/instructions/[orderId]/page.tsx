import type { Metadata } from "next";
import Link from "next/link";

import { formatMoney, isCurrency } from "@/lib/catalogue";
import { wiseAccountFor } from "@/lib/payments/wise-receiving";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* ==========================================================================
   /checkout/instructions/[orderId]
   --------------------------------------------------------------------------
   Wise has no hosted page of its own the way Stripe Checkout does, so this is
   it: the one screen that tells a buyer what to send and how to reference it.

   Everything shown comes from re-reading the order by its id, never from the
   URL beyond that id — the same discipline /checkout/success holds for a
   Stripe session, for the same reason: a page that trusts its own query
   string is a page anyone can screenshot into looking paid.

   The id itself is the access control. It is a UUID nobody could guess, this
   route is unauthenticated because a buyer has no account yet, and the admin
   client is used to read past RLS for exactly that reason — the same trade
   /api/checkout already makes to write the row in the first place.
   ========================================================================== */

export const metadata: Metadata = { title: "Bank transfer details" };
export const dynamic = "force-dynamic";

interface OrderRow {
  id: string;
  status: string;
  currency: string;
  amount_total_minor: number;
  sku_name: string;
  payment_reference: string | null;
}

const SETTLED = new Set(["paid", "instalments_active", "completed"]);
const DEAD = new Set(["refunded", "cancelled"]);

export default async function CheckoutInstructionsPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  const db = createSupabaseAdminClient();
  const { data: order } = await db
    .from("orders")
    .select("id, status, currency, amount_total_minor, sku_name, payment_reference")
    .eq("id", orderId)
    .eq("provider", "wise")
    .maybeSingle<OrderRow>();

  if (!order) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-3xl font-semibold text-ink">We can&rsquo;t find that order</h1>
        <p className="max-w-prose text-ink-500">
          The link may be old or mistyped. If you have already sent a transfer, get in touch and we
          will match it up by hand.
        </p>
        <ContactLink />
      </div>
    );
  }

  if (SETTLED.has(order.status)) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-3xl font-semibold text-ink">Already received</h1>
        <p className="max-w-prose text-ink-500">
          Your transfer for {order.sku_name} has been matched and recorded. Nothing more is needed —
          watch for an email with your portal link.
        </p>
      </div>
    );
  }

  if (DEAD.has(order.status)) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-3xl font-semibold text-ink">This order is no longer active</h1>
        <p className="max-w-prose text-ink-500">
          If you believe this is wrong, get in touch and we will sort it out.
        </p>
        <ContactLink />
      </div>
    );
  }

  const currency = isCurrency(order.currency) ? order.currency : null;
  const account = currency ? wiseAccountFor(currency) : null;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="font-display text-3xl font-semibold text-ink">Send your bank transfer</h1>
        <p className="max-w-prose text-ink-500">
          Nothing has been charged yet. Send the amount below by bank transfer, quoting the reference
          exactly — that is the only way we can tell it was you.
        </p>
      </header>

      <div className="rounded-2xl border border-rule bg-white p-6 space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">Amount</p>
          <p className="font-display text-3xl font-semibold text-ink tabular-nums">
            {currency ? formatMoney(order.amount_total_minor / 100, currency) : order.amount_total_minor}
          </p>
          <p className="mt-1 text-sm text-ink-500">for {order.sku_name}</p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">Reference</p>
          <p className="font-display text-2xl font-semibold tracking-wide text-ink">
            {order.payment_reference}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            Put this in the payment reference / description field on your transfer.
          </p>
        </div>

        {account ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
              Pay to — {account.label}
            </p>
            <dl className="mt-1 space-y-0.5 text-sm text-ink-700">
              <div>
                <dt className="inline text-ink-500">Account holder: </dt>
                <dd className="inline">{account.accountHolder}</dd>
              </div>
              {account.details.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </dl>
          </div>
        ) : (
          <p className="text-sm text-amber-900">
            We could not load the receiving account for this order. Get in touch and quote your
            reference above.
          </p>
        )}
      </div>

      <p className="max-w-prose text-sm text-ink-500">
        Bank transfers usually arrive within one to two business days. We will email you once it is
        matched — nothing more is needed from you until then.
      </p>

      <ContactLink />
    </div>
  );
}

function ContactLink() {
  return (
    <p className="text-sm">
      <Link href="/login" className="underline underline-offset-2">
        Already have a portal account?
      </Link>
      {" · "}
      <a href="https://ownyourstudy.com" className="underline underline-offset-2">
        Back to the site
      </a>
    </p>
  );
}
