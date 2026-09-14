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
export const STRIPE_PRICES: Readonly<Record<string, SkuPrices>> = {
  "single-session": {
    full: { live: "price_1UFdk8S8l8UHXssEfiODtaeb" },
  },
  "starter-5hr": {
    full: { live: "price_1UFdk9S8l8UHXssExDwE44xM" },
  },
  "standard-10hr": {
    full: { live: "price_1UFdkBS8l8UHXssE9rzsMTjD" },
  },
  "committed-20hr": {
    full: { live: "price_1UFdkCS8l8UHXssECJSgTwmo" },
    instalments: { live: "price_1UFdkDS8l8UHXssEduFLXMcp" },
  },
  "foundation-10s": {
    full: { live: "price_1UFdkES8l8UHXssEEfroSKfY" },
    instalments: { live: "price_1UFdkFS8l8UHXssE1VhidnFT" },
  },
  "momentum-20s": {
    full: { live: "price_1UFdkGS8l8UHXssEY2lG59VP" },
    instalments: { live: "price_1UFdkHS8l8UHXssE92VorsbX" },
  },
  "achiever-40s": {
    full: { live: "price_1UFdkJS8l8UHXssETj5Vbdx0" },
    instalments: { live: "price_1UFdkJS8l8UHXssERk7WcNtz" },
  },
  "elite-60s": {
    full: { live: "price_1UFdkKS8l8UHXssEILT3bFk3" },
    instalments: { live: "price_1UFdkLS8l8UHXssELPI3cvMt" },
  },
  "ia-strategy": {
    full: { live: "price_1UFdkMS8l8UHXssEwpDZtpmb" },
  },
  "exam-strategy": {
    full: { live: "price_1UFdkNS8l8UHXssE4aUUfcP9" },
  },
  "mock-exam": {
    full: { live: "price_1UFdkPS8l8UHXssEw164FY90" },
  },
  "profile-review": {
    full: { live: "price_1UFdkQS8l8UHXssECt4AbsgF" },
  },
  "question-bank": {
    full: { live: "price_1UFdkRS8l8UHXssExqehfFGz" },
  },
};
