/* ==========================================================================
   Stripe price IDs — GENERATED, DO NOT EDIT BY HAND
   --------------------------------------------------------------------------
   Written by `npm run stripe:setup`, which creates the products and prices in
   Stripe from the catalogue and records what it made here.

   Kept apart from catalogue.ts on purpose. The catalogue is authored — what a
   thing costs and why — and a script that rewrites hand-written source to slot
   in an identifier is a script that eventually eats a comment. These are only
   identifiers, and they are not secret: a price ID appears in the URL of every
   Checkout Session. They belong in the repository, because the deployed code
   and the prices it charges against have to move together.

   Test and live are separate Stripe accounts in all but name, so a price
   exists in one and not the other until the script is run against both.
   ========================================================================== */

export const STRIPE_MODES = ["test", "live"] as const;
export type StripeMode = (typeof STRIPE_MODES)[number];

export interface PriceRef {
  test?: string;
  live?: string;
}

export interface SkuPrices {
  /** One-off price, charged in Checkout `payment` mode. */
  full?: PriceRef;
  /** Recurring monthly price the instalment schedule bills. */
  instalments?: PriceRef;
}

/** Keyed by catalogue slug. Empty until the setup script has been run. */
export const STRIPE_PRICES: Readonly<Record<string, SkuPrices>> = {};
