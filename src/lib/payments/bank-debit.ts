/* ==========================================================================
   Bank debit, and nothing else
   --------------------------------------------------------------------------
   The decision this file encodes: buyers pay by direct debit from their bank
   account, not by card. Stripe's fee on a card is a percentage with no ceiling
   — 1.7% domestic, 3.5% international, plus 2% when a currency has to be
   converted. Every bank debit scheme below caps it instead, and SEPA does not
   charge a percentage at all. On a six-thousand-euro programme that is the
   difference between roughly EUR 343 and EUR 0.35.

   What it costs, and it is not nothing:

     Settlement is slow. SEPA confirms in six business days, Bacs in four to
     seven, so a buyer is authorised long before they have paid. The order
     status vocabulary already separates `authorised` from `paid` and grants
     nothing on the former, which is exactly this case.

     Disputes are worse than cards and cannot be appealed. SEPA reverses on no
     grounds at all for eight weeks. Bacs has no time limit whatsoever, and a
     refund does not close it out — Stripe's own documentation warns you can
     lose the refund and the disputed amount both. There is no evidence process
     to win, the way there is with a card chargeback.

   The scheme is chosen by the currency, because that is what the schemes
   themselves are keyed on — a euro is debited over SEPA or it is not debited.
   Availability is a property of the *seller's* country as much as the buyer's,
   and this seller is Australian:

     AUD  PayTo                 live
     EUR  SEPA Direct Debit     Australian businesses are eligible; must be
                                requested in the Dashboard and identity-verified
     GBP  Bacs Direct Debit     same
     USD  ACH Direct Debit      NOT open to Australian businesses. Stripe's
                                eligibility list is US, Canada in preview, and
                                Europe. There is no route to it short of a US
                                entity, so USD has no bank debit at all.

   `activated` is the half that has to be kept in step with the Stripe
   Dashboard by hand. It is deliberately not inferred from a live capability
   call: the checkout page renders on every visit and must not depend on an API
   round trip to decide whether to show a button. Flipping one of these to true
   before the Dashboard agrees produces a session Stripe refuses, which the
   checkout route already catches and reports.
   ========================================================================== */

import type { Currency } from "@/lib/catalogue";

export interface BankDebit {
  /** Stripe's payment_method_types value. */
  method: "payto" | "sepa_debit" | "bacs_debit";
  /** What a buyer sees it called. */
  label: string;
  /**
   * The scheme's per-transaction ceiling, in whole major units. A charge above
   * it is not offered at all rather than failing at the payment step.
   */
  limit: number;
  /** Whether the Stripe account can actually take it today. */
  activated: boolean;
}

const BY_CURRENCY: Record<Currency, BankDebit | null> = {
  aud: { method: "payto", label: "PayTo", limit: 10_000, activated: true },
  eur: { method: "sepa_debit", label: "SEPA Direct Debit", limit: 10_000, activated: false },
  gbp: { method: "bacs_debit", label: "Bacs Direct Debit", limit: 10_000, activated: false },
  usd: null,
};

/** The scheme for a currency, whether or not it is switched on yet. */
export function schemeFor(currency: Currency): BankDebit | null {
  return BY_CURRENCY[currency];
}

export type Refusal = "no_scheme" | "not_activated" | "over_limit";

/**
 * The one question the checkout page and the checkout route both ask, so they
 * cannot disagree about it: can this amount be taken in this currency?
 *
 * Returns the scheme to charge against, or why not. A page that renders a
 * button the route then refuses is worse than one that never rendered it.
 */
export function bankDebitFor(
  currency: Currency,
  amount: number,
): { ok: true; scheme: BankDebit } | { ok: false; reason: Refusal; scheme: BankDebit | null } {
  const scheme = BY_CURRENCY[currency];
  if (!scheme) return { ok: false, reason: "no_scheme", scheme: null };
  if (!scheme.activated) return { ok: false, reason: "not_activated", scheme };
  if (amount > scheme.limit) return { ok: false, reason: "over_limit", scheme };
  return { ok: true, scheme };
}

/** Why a buyer cannot pay, in words meant for the buyer rather than for us. */
export function explainRefusal(reason: Refusal, scheme: BankDebit | null, currency: Currency): string {
  switch (reason) {
    case "no_scheme":
      return (
        `We take payment by direct debit from your bank, and there is no direct ` +
        `debit scheme we can use for ${currency.toUpperCase()}. Get in touch and ` +
        `we will invoice you.`
      );
    case "not_activated":
      return (
        `${scheme?.label} is still being set up for ${currency.toUpperCase()}. ` +
        `Get in touch and we will invoice you in the meantime.`
      );
    case "over_limit":
      return (
        `${scheme?.label} cannot take a single payment this large — its limit is ` +
        `${scheme?.limit.toLocaleString()} ${currency.toUpperCase()}. Paying monthly ` +
        `splits it into instalments that fit; otherwise get in touch and we will invoice you.`
      );
  }
}
