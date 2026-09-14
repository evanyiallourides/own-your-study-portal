import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  amountFor,
  baseCurrencyFor,
  formatMoney,
  gstComponent,
  isCurrency,
  priceIdFor,
  skuFor,
  type Currency,
} from "@/lib/catalogue";
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

   Instalment SKUs show two buttons, and the copy under them is not decoration.
   Stripe does not allow Klarna, Zip or Afterpay in subscription mode, so
   choosing to pay monthly really does mean card only, and saying so here is
   cheaper than a surprise at the payment step.
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

      {!sellable ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
          <p className="font-semibold">Not on sale here yet.</p>
          <p className="mt-1">
            {isDemoMode()
              ? "This portal is running in demo mode, which cannot take payments."
              : "Payments are still being set up on this deployment. Please get in touch and we will invoice you directly."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
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
            <button
              type="submit"
              className="rounded-xl bg-accent px-5 py-4 text-left text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span className="block font-semibold">
                Pay in full — {formatMoney(total, currency)}
              </span>
              <span className="mt-0.5 block text-xs opacity-80">
                Card, Apple Pay, and pay-later options where available
              </span>
            </button>
          </form>

          {perInstalment !== null && sku.instalments && instalmentsSellable && (
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
                {/* Not a footnote: Stripe does not permit pay-later methods in
                    subscription mode, so this really is card only. */}
                <span className="mt-0.5 block text-xs text-ink-500">
                  Card only · first payment today
                </span>
              </button>
            </form>
          )}
        </div>
      )}

      <p className="text-xs text-ink-500">
        You will be taken to Stripe to pay. Prices shown in{" "}
        {currency.toUpperCase()}
        {currency === "aud" ? ", inclusive of GST" : ""}.
      </p>
    </div>
  );
}
