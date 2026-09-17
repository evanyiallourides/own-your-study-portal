import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  amountFor,
  baseCurrencyFor,
  formatMoney,
  gstComponent,
  isCurrency,
  offersPayInFull,
  priceIdFor,
  skuFor,
  type Currency,
} from "@/lib/catalogue";
import { bankDebitFor, explainRefusal } from "@/lib/payments/bank-debit";
import { isDemoMode, stripeMode } from "@/lib/env";
import { stripeConfigured } from "@/lib/payments/stripe";

/* ==========================================================================
   /checkout/[slug]
   --------------------------------------------------------------------------
   The one page on the portal a stranger is meant to land on. It renders from
   the catalogue and posts a plain form to /api/checkout, which redirects to
   Stripe. No client JavaScript, no Stripe.js: a form post to a route handler
   that 303s is the shortest path that still works with a slow connection and a
   blocked script, and it matches how little JavaScript the rest of this site
   asks for.

   Cards are not offered. Every button here charges a direct debit against the
   buyer's own bank account — PayTo in Australia, SEPA in the euro zone, Bacs
   in the UK — because the fee on those is capped and the fee on a card is not.
   src/lib/payments/bank-debit.ts holds that decision, what it costs, and which
   currencies have a scheme at all.

   Which is why a button can be missing. There is no direct debit scheme an
   Australian business can use for US dollars, and each scheme has a ceiling a
   single charge cannot exceed. Both buttons are therefore gated on their own
   charge rather than on the package total: the largest programme is over
   PayTo's limit paid at once and under it paid monthly, so the monthly button
   survives where the other cannot. When neither can, the page says which
   scheme is missing rather than showing a button the route would refuse.

   Instalment SKUs otherwise show two buttons, and the copy under them is not
   decoration — it names the scheme that will debit them, because a buyer who
   does not recognise the name on their bank statement is a dispute waiting to
   happen, and these disputes cannot be appealed.

   ========================================================================== */

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const sku = skuFor((await params).slug);
  return { title: sku ? `Buy ${sku.name}` : "Checkout" };
}

const one = (value: string | string[] | undefined): string | null =>
  typeof value === "string" ? value : null;

export default async function CheckoutPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const query = await searchParams;

  const sku = skuFor(slug);
  if (!sku) notFound();

  const site = one(query.site);
  if (sku.ibOnly && site && site !== "own-your-ib") notFound();

  const requested = one(query.ccy);
  const currency: Currency =
    requested && isCurrency(requested) ? requested : baseCurrencyFor(site);

  const total = amountFor(sku, currency, "full");
  const perInstalment = sku.instalments ? amountFor(sku, currency, "instalments") : null;

  const mode = stripeMode();
  const sellable =
    !isDemoMode() && stripeConfigured() && mode !== null && priceIdFor(sku, "full", mode) !== null;
  const instalmentsSellable =
    sellable && mode !== null && sku.instalments && priceIdFor(sku, "instalments", mode) !== null;

  /* Each button is gated on its own charge, not on the package total. That
     distinction is the whole point for the largest programme: A$11,040 is over
     PayTo's ceiling in one go, while the same programme at six monthly charges
     of A$1,840 is comfortably under it. Asking per charge is what lets the
     monthly button stay when the pay-in-full button cannot. */
  const fullBank = bankDebitFor(currency, total);
  const instalmentBank =
    perInstalment !== null ? bankDebitFor(currency, perInstalment) : null;
  const canPayInFull = sellable && fullBank.ok && offersPayInFull(sku);
  const canPayMonthly = Boolean(instalmentsSellable && instalmentBank?.ok);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          {sku.group === "summer" ? "Summer program" : sku.group === "module" ? "Add-on" : "Tutoring package"}
        </p>
        <h1 className="font-display text-4xl font-semibold text-ink">{sku.name}</h1>
        <p className="max-w-prose text-ink-500">{sku.blurb}</p>
      </header>

      <div className="rounded-2xl border border-rule bg-white p-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-3xl font-semibold text-ink tabular-nums">
            {formatMoney(total, currency)}
          </span>
          {sku.hours !== null && (
            <span className="text-sm text-ink-500">
              {sku.hours} {sku.hours === 1 ? "hour" : "hours"} ·{" "}
              {formatMoney(Math.round(total / sku.hours), currency)}/hr
            </span>
          )}
        </div>
        {currency === "aud" && (
          <p className="mt-1 text-sm text-ink-500">
            Includes {formatMoney(Math.round(gstComponent(total)), "aud")} GST.
          </p>
        )}
      </div>

      {!sellable || (!canPayInFull && !canPayMonthly) ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
          <p className="font-semibold">Not on sale here yet.</p>
          <p className="mt-1">
            {isDemoMode()
              ? "This portal is running in demo mode, which cannot take payments."
              : !sellable
                ? "Payments are still being set up on this deployment. Please get in touch and we will invoice you directly."
                : /* The specific reason, not a shrug. A buyer told which scheme
                     is missing and in which currency can tell us something
                     useful when they get in touch. */
                  explainRefusal(
                    fullBank.ok ? "over_limit" : fullBank.reason,
                    fullBank.scheme,
                    currency,
                  )}
          </p>
          <p className="mt-3">
            <a href="https://ownyourstudy.com/own-your-ib/contact.html" className="font-semibold underline underline-offset-2">
              Get in touch
            </a>
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {canPayInFull && (
          <form method="POST" action="/api/checkout" className="contents">
            <input type="hidden" name="sku" value={sku.slug} />
            <input type="hidden" name="plan" value="full" />
            <input type="hidden" name="ccy" value={currency} />
            <input type="hidden" name="site" value={site ?? ""} />
            {sku.quantityAdjustable && (
              <label className="sm:col-span-2 flex items-center gap-3 text-sm text-ink-700">
                How many?
                <input
                  type="number"
                  name="qty"
                  defaultValue={1}
                  min={1}
                  max={20}
                  className="w-20 rounded-lg border border-rule px-3 py-2 tabular-nums"
                />
              </label>
            )}
            {sku.grants !== null && (
              /* Digital, and handed over the moment access is granted. In the
                 UK and EU the fourteen-day cancellation right survives unless
                 the buyer asks for immediate access AND acknowledges losing it,
                 so the refund policy's "not refundable once you open it" is
                 only true if that is actually captured here. Required, so the
                 form will not submit without it.

                 The wording follows what is actually being bought. "Once it is
                 open" describes a question bank and does not describe a review
                 of your coursework, and an acknowledgement that misdescribes
                 the thing it is waiving the right to is not much of one. An IA
                 review keeps its cancellation right until a review is actually
                 run — which is also why unused credits come back on a refund
                 and used ones do not. */
              <label className="sm:col-span-2 flex items-start gap-3 rounded-xl border border-rule bg-white p-4 text-sm text-ink-700">
                <input
                  type="checkbox"
                  name="waive_cooling_off"
                  value="yes"
                  required
                  className="mt-0.5 h-4 w-4 flex-none"
                />
                <span>
                  {sku.grants.iaMarkings
                    ? "I want to use this straight away, and I understand that a review I have had back is not refundable. Reviews I have not used still are."
                    : "I want access straight away, and I understand that once it is open this is no longer refundable."}{" "}
                  <a
                    href="https://ownyourstudy.com/refunds.html"
                    className="underline underline-offset-2"
                  >
                    Refund policy
                  </a>
                </span>
              </label>
            )}
            <button
              type="submit"
              className="rounded-xl bg-accent px-5 py-4 text-left text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span className="block font-semibold">
                Pay in full — {formatMoney(total, currency)}
              </span>
              <span className="mt-0.5 block text-xs opacity-80">
                {fullBank.ok ? fullBank.scheme.label : ""} · direct debit from your bank
              </span>
            </button>
          </form>
          )}

          {perInstalment !== null && sku.instalments && canPayMonthly && (
            <form method="POST" action="/api/checkout" className="contents">
              <input type="hidden" name="sku" value={sku.slug} />
              <input type="hidden" name="plan" value="instalments" />
              <input type="hidden" name="ccy" value={currency} />
              <input type="hidden" name="site" value={site ?? ""} />
              <button
                type="submit"
                className="rounded-xl border border-ink px-5 py-4 text-left text-ink transition hover:bg-paper-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span className="block font-semibold">
                  {sku.instalments.months} monthly payments of{" "}
                  {formatMoney(perInstalment, currency)}
                </span>
                {/* Not a footnote: no pay-later method works in subscription
                    mode, so this is the one place a buyer learns that paying
                    monthly costs them Klarna, Zip and Afterpay. */}
                <span className="mt-0.5 block text-xs text-ink-500">
                  {instalmentBank?.ok ? instalmentBank.scheme.label : "Direct debit"} · first
                  payment today
                </span>
              </button>
            </form>
          )}
        </div>
      )}

      <p className="text-xs text-ink-500">
        <a href="https://ownyourstudy.com/refunds.html" className="underline underline-offset-2">
          Refunds and cancellations
        </a>
        {" · "}
        You will be taken to Stripe to pay. Prices shown in{" "}
        {currency.toUpperCase()}
        {currency === "aud" ? ", inclusive of GST" : ""}.
      </p>
    </div>
  );
}
