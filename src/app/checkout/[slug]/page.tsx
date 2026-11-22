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
  type Sku,
} from "@/lib/catalogue";
import { CheckoutShell } from "@/components/checkout/checkout-shell";
import { bankDebitFor, explainRefusal } from "@/lib/payments/bank-debit";
import { checkoutErrorMessage, isEmbed } from "@/lib/payments/checkout-embed";
import { INSTALMENTS_ENABLED, providerFor } from "@/lib/payments/provider";
import { explainWiseRefusal, wiseAccountFor } from "@/lib/payments/wise-receiving";
import { isDemoMode, stripeMode } from "@/lib/env";
import { btcPayConfig } from "@/lib/payments/btcpay";
import { stripeConfigured } from "@/lib/payments/stripe";

/* ==========================================================================
   /checkout/[slug]
   --------------------------------------------------------------------------
   The one page on the portal a stranger is meant to land on. It renders from
   the catalogue and posts a plain form to /api/checkout. No client
   JavaScript: a form post to a route handler that redirects is the shortest
   path that still works with a slow connection and a blocked script.

   AUD and EUR charge a direct debit against the buyer's own bank account —
   PayTo and SEPA Direct Debit — because the fee on that is capped and the fee
   on a card is not (src/lib/payments/bank-debit.ts). USD and GBP are paid by a
   direct bank transfer via Wise instead, because there is no working
   direct-debit scheme this business can offer for them today. Which provider
   a currency uses is the one decision in src/lib/payments/provider.ts;
   everything below just asks it.

   Payment plans are switched off everywhere for now — see
   INSTALMENTS_ENABLED in provider.ts for why and how that comes back.

   Opened with ?embed=1 this is the marketing site's checkout sheet: same form,
   no logo or footer, and a refusal comes back here with a reason instead of as
   JSON (see checkout-embed.ts). Only the bank-transfer branch is ever shown
   that way — Stripe's hosted page cannot be framed, so AUD leaves the sheet.
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
  const currency: Currency = requested && isCurrency(requested) ? requested : baseCurrencyFor(site);

  const total = amountFor(sku, currency, "full");
  const contactHref = `https://ownyourstudy.com/${site ?? "own-your-ib"}/contact.html`;

  const embed = isEmbed(query.embed);
  const error = checkoutErrorMessage(query.error);

  const stripe = providerFor(currency) === "stripe";
  const fullPage = `/checkout/${sku.slug}?${new URLSearchParams({
    ...(site ? { site } : {}),
    ccy: currency,
  }).toString()}`;

  return (
    <CheckoutShell embed={embed}>
      {stripe && embed ? (
        /* Not reachable from the sheet, which leaves Stripe links alone — this is
           for a link that was framed some other way. Stripe's page refuses to
           render in a frame, so the honest thing is to leave it. */
        <div className="space-y-4">
          <h1 className="font-display text-2xl font-semibold text-ink">{sku.name}</h1>
          <p className="max-w-prose text-sm text-ink-500">
            {currency.toUpperCase()} payments are completed on a secure Stripe page.
          </p>
          <a
            href={fullPage}
            target="_top"
            className="inline-block rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white hover:opacity-90"
          >
            Continue to secure checkout
          </a>
        </div>
      ) : stripe ? (
        <StripeCheckout sku={sku} site={site} currency={currency} total={total} contactHref={contactHref} />
      ) : (
        <WiseCheckout
          sku={sku}
          site={site}
          currency={currency}
          total={total}
          contactHref={contactHref}
          embed={embed}
          error={error}
        />
      )}
      <BitcoinCheckout sku={sku} site={site} currency={currency} total={total} contactHref={contactHref} />
    </CheckoutShell>
  );
}

interface BranchProps {
  sku: Sku;
  site: string | null;
  currency: Currency;
  total: number;
  contactHref: string;
}

function NotSellable({ children, contactHref }: { children: React.ReactNode; contactHref: string }) {
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
      <p className="font-semibold">Not on sale here yet.</p>
      <p className="mt-1">{children}</p>
      <p className="mt-3">
        <a href={contactHref} className="font-semibold underline underline-offset-2">
          Get in touch
        </a>
      </p>
    </div>
  );
}

function PriceSummary({ sku, total, currency }: { sku: Sku; total: number; currency: Currency }) {
  return (
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
  );
}

/** The cooling-off waiver and quantity field, identical regardless of who is paid. */
function SharedFormFields({ sku }: { sku: Sku }) {
  return (
    <>
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
        /* Digital, and handed over the moment access is granted. In the UK and
           EU the fourteen-day cancellation right survives unless the buyer
           asks for immediate access AND acknowledges losing it, so the refund
           policy's "not refundable once you open it" is only true if that is
           actually captured here. Required, so the form will not submit
           without it. */
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
            <a href="https://ownyourstudy.com/refunds.html" className="underline underline-offset-2">
              Refund policy
            </a>
          </span>
        </label>
      )}
    </>
  );
}

/** Who this is for — asked in our own form for Wise, since there is no later
    hosted step to collect it. Stripe asks the same thing as Checkout custom
    fields instead; kept here so both providers ask it the same way. */
function BuyerFields() {
  return (
    <>
      <label className="sm:col-span-2 flex flex-col gap-1 text-sm text-ink-700">
        Your email
        <input
          type="email"
          name="buyer_email"
          required
          className="rounded-lg border border-rule px-3 py-2"
        />
      </label>
      <label className="sm:col-span-2 flex flex-col gap-1 text-sm text-ink-700">
        Your name (optional)
        <input type="text" name="buyer_name" className="rounded-lg border border-rule px-3 py-2" />
      </label>
      <label className="sm:col-span-2 flex flex-col gap-1 text-sm text-ink-700">
        Student&rsquo;s name (leave blank if it&rsquo;s you)
        <input type="text" name="student_name" className="rounded-lg border border-rule px-3 py-2" />
      </label>
      <label className="sm:col-span-2 flex flex-col gap-1 text-sm text-ink-700">
        Student&rsquo;s email (leave blank if it&rsquo;s yours)
        <input type="email" name="student_email" className="rounded-lg border border-rule px-3 py-2" />
      </label>
      <fieldset className="sm:col-span-2 flex flex-col gap-1 text-sm text-ink-700">
        <legend>Are you their parent or guardian?</legend>
        <select name="is_guardian" defaultValue="" className="rounded-lg border border-rule px-3 py-2">
          <option value="">No / not applicable</option>
          <option value="yes">Yes — give me a parent account</option>
          <option value="no">No — just buying on their behalf</option>
        </select>
      </fieldset>
    </>
  );
}

function StripeCheckout({ sku, site, currency, total, contactHref }: BranchProps) {
  const perInstalment = sku.instalments ? amountFor(sku, currency, "instalments") : null;

  const mode = stripeMode();
  const sellable =
    !isDemoMode() && stripeConfigured() && mode !== null && priceIdFor(sku, "full", mode) !== null;
  const instalmentsSellable =
    sellable && mode !== null && sku.instalments && priceIdFor(sku, "instalments", mode) !== null;

  /* Each button is gated on its own charge, not on the package total. That
     distinction is the whole point for the largest programme: A$11,040 is over
     PayTo's ceiling in one go, while the same programme at six monthly charges
     of A$1,840 is comfortably under it. */
  const fullBank = bankDebitFor(currency, total);
  const instalmentBank = perInstalment !== null ? bankDebitFor(currency, perInstalment) : null;
  const canPayInFull = sellable && fullBank.ok && offersPayInFull(sku);
  const canPayMonthly = INSTALMENTS_ENABLED && Boolean(instalmentsSellable && instalmentBank?.ok);

  return (
    <div className="space-y-8">
      <Header sku={sku} />
      <PriceSummary sku={sku} total={total} currency={currency} />

      {!sellable || (!canPayInFull && !canPayMonthly) ? (
        <NotSellable contactHref={contactHref}>
          {isDemoMode()
            ? "This portal is running in demo mode, which cannot take payments."
            : !sellable
              ? "Payments are still being set up on this deployment. Please get in touch and we will invoice you directly."
              : !INSTALMENTS_ENABLED && !offersPayInFull(sku)
                ? "This programme is sold as a monthly plan, and payment plans aren't available right now. Get in touch and we will arrange it."
                : explainRefusal(fullBank.ok ? "over_limit" : fullBank.reason, fullBank.scheme, currency)}
        </NotSellable>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {canPayInFull && (
            <form method="POST" action="/api/checkout" className="contents">
              <input type="hidden" name="sku" value={sku.slug} />
              <input type="hidden" name="plan" value="full" />
              <input type="hidden" name="ccy" value={currency} />
              <input type="hidden" name="site" value={site ?? ""} />
              <SharedFormFields sku={sku} />
              <button
                type="submit"
                className="rounded-xl bg-accent px-5 py-4 text-left text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span className="block font-semibold">Pay in full — {formatMoney(total, currency)}</span>
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
                  {sku.instalments.months} monthly payments of {formatMoney(perInstalment, currency)}
                </span>
                <span className="mt-0.5 block text-xs text-ink-500">
                  {instalmentBank?.ok ? instalmentBank.scheme.label : "Direct debit"} · first payment
                  today
                </span>
              </button>
            </form>
          )}
        </div>
      )}

      <Footer currency={currency}>
        You will be taken to Stripe to pay.
      </Footer>
    </div>
  );
}

function WiseCheckout({
  sku,
  site,
  currency,
  total,
  contactHref,
  embed,
  error,
}: BranchProps & { embed: boolean; error: string | null }) {
  const account = wiseAccountFor(currency);
  const canPayInFull = !isDemoMode() && account !== null && offersPayInFull(sku);

  return (
    <div className="space-y-8">
      <Header sku={sku} />
      <PriceSummary sku={sku} total={total} currency={currency} />

      {error && (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </p>
      )}

      {!canPayInFull ? (
        <NotSellable contactHref={contactHref}>
          {isDemoMode()
            ? "This portal is running in demo mode, which cannot take payments."
            : account === null
              ? explainWiseRefusal(currency)
              : "This programme is not sold as a single payment right now. Get in touch and we will arrange it."}
        </NotSellable>
      ) : (
        <form method="POST" action="/api/checkout" className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="sku" value={sku.slug} />
          <input type="hidden" name="plan" value="full" />
          <input type="hidden" name="ccy" value={currency} />
          <input type="hidden" name="site" value={site ?? ""} />
          {embed && <input type="hidden" name="embed" value="1" />}
          <BuyerFields />
          <SharedFormFields sku={sku} />
          <button
            type="submit"
            className="sm:col-span-2 rounded-xl bg-accent px-5 py-4 text-left text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span className="block font-semibold">Pay by bank transfer — {formatMoney(total, currency)}</span>
            <span className="mt-0.5 block text-xs opacity-80">
              Wise · {account.label} · instructions on the next screen
            </span>
          </button>
        </form>
      )}

      <Footer currency={currency}>
        You&rsquo;ll get bank transfer details on the next screen.
      </Footer>
    </div>
  );
}

function Header({ sku }: { sku: Sku }) {
  return (
    <header className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
        {sku.group === "summer" ? "Summer program" : sku.group === "module" ? "Add-on" : "Tutoring package"}
      </p>
      <h1 className="font-display text-4xl font-semibold text-ink">{sku.name}</h1>
      <p className="max-w-prose text-ink-500">{sku.blurb}</p>
    </header>
  );
}

function Footer({ children, currency }: { children: React.ReactNode; currency: Currency }) {
  return (
    <p className="text-xs text-ink-500">
      <a href="https://ownyourstudy.com/refunds.html" className="underline underline-offset-2">
        Refunds and cancellations
      </a>
      {" · "}
      {children} Prices shown in {currency.toUpperCase()}
      {currency === "aud" ? ", inclusive of GST" : ""}.
    </p>
  );
}

/** Bitcoin always leaves the embedded sheet for its provider-hosted checkout. */
function BitcoinCheckout({ sku, site, currency, total }: BranchProps) {
  const ready = Boolean(btcPayConfig()) && !isDemoMode() && offersPayInFull(sku);
  return (
    <section aria-labelledby="bitcoin-title" className="mt-8 space-y-4 rounded-2xl border border-rule bg-white p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 id="bitcoin-title" className="font-display text-xl font-semibold text-ink">Pay with Bitcoin</h2>
        {!ready && <span className="rounded-full bg-paper px-3 py-1 text-sm text-ink-500">Coming soon</span>}
      </div>
      {ready ? (
        <>
          <p className="text-ink-500">Pay the Bitcoin equivalent of your order total. The next page shows the exact amount and a QR code. Your wallet may charge a network fee. Access is confirmed after the payment settles.</p>
          <form method="POST" action="/api/checkout" target="_top" className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="method" value="bitcoin" />
            <input type="hidden" name="sku" value={sku.slug} />
            <input type="hidden" name="plan" value="full" />
            <input type="hidden" name="ccy" value={currency} />
            <input type="hidden" name="site" value={site ?? ""} />
            <BuyerFields />
            <SharedFormFields sku={sku} />
            <button type="submit" className="sm:col-span-2 rounded-xl bg-accent px-5 py-4 text-left font-semibold text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              Continue with Bitcoin — {formatMoney(total, currency)}
            </button>
          </form>
        </>
      ) : <p className="text-ink-500">Bitcoin payments are not available yet. Please use the payment option above or contact us.</p>}
    </section>
  );
}
