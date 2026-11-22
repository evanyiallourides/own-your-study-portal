import type { Currency } from "@/lib/catalogue";
import { schemeFor } from "@/lib/payments/bank-debit";

/* ==========================================================================
   Which provider handles which currency
   --------------------------------------------------------------------------
   Stripe takes every currency whose direct-debit scheme is switched on in
   bank-debit.ts — PayTo for AUD, SEPA Direct Debit for EUR. Wise takes the
   rest: USD has no direct-debit scheme open to an Australian account at all,
   and GBP's (Bacs) is still waiting on Stripe's own dashboard verification.

   Derived from `activated` rather than kept as a second list, so there is one
   switch per currency, not two that can disagree: flip a scheme on in
   bank-debit.ts and that currency's checkout moves to Stripe with it. The
   marketing site's checkout sheet (assets/checkout-sheet.js) keeps its own
   copy of this list, because it is static and cannot import this file.
   ========================================================================== */
export type PaymentProvider = "stripe" | "wise";

export function providerFor(currency: Currency): PaymentProvider {
  return schemeFor(currency)?.activated ? "stripe" : "wise";
}

/**
 * Payment plans, off for now, everywhere — including AUD, where Stripe could
 * still run them. Wise has no recurring-billing primitive at all, and selling
 * a monthly plan on one provider and not the other mid-rollout is its own
 * source of confusion, so this turns instalments off uniformly rather than
 * per provider. One flag, so bringing them back later — on either provider —
 * is a one-line change here, not a hunt through the checkout route and page.
 */
export const INSTALMENTS_ENABLED = false;
