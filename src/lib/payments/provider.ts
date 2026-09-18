import type { Currency } from "@/lib/catalogue";

/* ==========================================================================
   Which provider handles which currency
   --------------------------------------------------------------------------
   AUD keeps using Stripe: PayTo direct debit already works and Stripe Tax
   already handles GST (see bank-debit.ts and catalogue.ts's gstComponent).
   Every other currency moves to Wise, because Stripe has no working
   bank-debit route for any of them — USD has none available to an
   Australian account at all, and EUR/GBP's are still waiting on Stripe's own
   dashboard verification.

   One function, so the split lives in exactly one place. If AUD ever needs
   to move to Wise too, or a currency moves the other way, this is the only
   line that changes.
   ========================================================================== */
export type PaymentProvider = "stripe" | "wise";

export function providerFor(currency: Currency): PaymentProvider {
  return currency === "aud" ? "stripe" : "wise";
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
