import type { Metadata } from "next";
import Link from "next/link";

import { CheckoutShell } from "@/components/checkout/checkout-shell";
import { CopyField } from "@/components/checkout/copy-field";
import { EmbedCloseButton, EmbedSignal } from "@/components/checkout/embed-bridge";
import { StatusWatcher } from "@/components/checkout/status-watcher";
import { formatMoney, isCurrency } from "@/lib/catalogue";
import { emailConfigured } from "@/lib/email/send";
import { isEmbed } from "@/lib/payments/checkout-embed";
import { splitDetailLine } from "@/lib/payments/detail-line";
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

   This is also what the marketing site's checkout sheet shows (?embed=1). A
   transfer cannot be approved with a tap the way a card can — the buyer has to
   go and make it in their own bank — so what this page does instead is make
   the carrying-across as easy as it can be (every value copies in one tap) and
   then stay put: it re-reads the order every few seconds, so the moment the
   payment is marked received this turns into a confirmation without the buyer
   doing anything.
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
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { orderId } = await params;
  const embed = isEmbed((await searchParams).embed);

  const db = createSupabaseAdminClient();
  const { data: order } = await db
    .from("orders")
    .select("id, status, currency, amount_total_minor, sku_name, payment_reference")
    .eq("id", orderId)
    .eq("provider", "wise")
    .maybeSingle<OrderRow>();

  if (!order) {
    return (
      <CheckoutShell embed={embed}>
        <div className="space-y-4">
          <h1 className="font-display text-3xl font-semibold text-ink">We can&rsquo;t find that order</h1>
          <p className="max-w-prose text-ink-500">
            The link may be old or mistyped. If you have already sent a transfer, get in touch and we
            will match it up by hand.
          </p>
          <ContactLink embed={embed} />
        </div>
      </CheckoutShell>
    );
  }

  if (SETTLED.has(order.status)) {
    return (
      <CheckoutShell embed={embed}>
        {/* Tells the sheet it can stop waiting. */}
        {embed && <EmbedSignal type="paid" />}
        <div className="space-y-4">
          <div
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-2xl text-white"
          >
            &#10003;
          </div>
          <h1 className="font-display text-3xl font-semibold text-ink">Payment received</h1>
          <p className="max-w-prose text-ink-500">
            Your transfer for {order.sku_name} has been matched and recorded. Nothing more is needed
            from you &mdash; if your portal access has not appeared shortly, get in touch.
          </p>
          <ContactLink embed={embed} />
        </div>
      </CheckoutShell>
    );
  }

  if (DEAD.has(order.status)) {
    return (
      <CheckoutShell embed={embed}>
        <div className="space-y-4">
          <h1 className="font-display text-3xl font-semibold text-ink">This order is no longer active</h1>
          <p className="max-w-prose text-ink-500">
            If you believe this is wrong, get in touch and we will sort it out.
          </p>
          <ContactLink embed={embed} />
        </div>
      </CheckoutShell>
    );
  }

  const currency = isCurrency(order.currency) ? order.currency : null;
  const account = currency ? wiseAccountFor(currency) : null;
  const amountShown = currency ? formatMoney(order.amount_total_minor / 100, currency) : String(order.amount_total_minor);
  // What a bank's amount box wants: digits and a decimal point, no symbol.
  const amountToCopy = (order.amount_total_minor / 100).toFixed(2);

  return (
    <CheckoutShell embed={embed}>
      {/* Only while we are still waiting; the settled view above has no need. */}
      <StatusWatcher />

      <div className="space-y-6">
        <header className="space-y-2">
          <h1 className="font-display text-3xl font-semibold text-ink">Send your bank transfer</h1>
          <p className="max-w-prose text-sm text-ink-500">
            Nothing has been charged. Open your bank&rsquo;s app or website, make a transfer with the
            details below, and quote the reference exactly &mdash; it is how we know the money is
            yours.
          </p>
        </header>

        <div className="divide-y divide-rule rounded-2xl border border-rule bg-white px-5">
          <CopyField label="Amount" value={amountShown} copyValue={amountToCopy} emphasis />
          <CopyField label="Reference" value={order.payment_reference ?? "—"} emphasis />

          {account ? (
            <>
              <CopyField label="Account holder" value={account.accountHolder} />
              {account.details.map((line, i) => {
                const { label, value } = splitDetailLine(line);
                return <CopyField key={i} label={label} value={value} />;
              })}
            </>
          ) : (
            <p className="py-4 text-sm text-amber-900">
              We could not load the receiving account for this order. Get in touch and quote your
              reference above.
            </p>
          )}
        </div>

        <p className="text-xs text-ink-500">
          For {order.sku_name}
          {account ? ` · ${account.label}` : ""}. Send the full amount so the whole of it arrives
          &mdash; some banks take a fee off the top.
        </p>

        <div
          role="status"
          className="flex items-start gap-3 rounded-xl bg-paper-2 px-4 py-3 text-sm text-ink-700"
        >
          <span aria-hidden="true" className="mt-1.5 h-2 w-2 flex-none animate-pulse rounded-full bg-accent" />
          <p>
            Waiting for your transfer. This page updates by itself when it arrives. Transfers
            usually take one to two business days, and your access is set up once yours is matched
            &mdash;{" "}
            {emailConfigured()
              ? "we will email a copy of these details to the address you gave, and a receipt once your transfer is matched."
              : "so make a note of the reference above before you close this."}
          </p>
        </div>

        <ContactLink embed={embed} />
      </div>
    </CheckoutShell>
  );
}

function ContactLink({ embed }: { embed: boolean }) {
  return (
    <p className="text-sm">
      <Link href="/login" className="underline underline-offset-2">
        Already have a portal account?
      </Link>
      {" · "}
      {embed ? (
        <EmbedCloseButton>Close</EmbedCloseButton>
      ) : (
        <a href="https://ownyourstudy.com" className="underline underline-offset-2">
          Back to the site
        </a>
      )}
    </p>
  );
}
