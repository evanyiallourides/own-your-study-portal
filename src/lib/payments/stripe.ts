import "server-only";

import Stripe from "stripe";

import { env, stripeMode } from "@/lib/env";
import type { StripeMode } from "@/lib/stripe-prices.generated";

/* ==========================================================================
   The Stripe client
   --------------------------------------------------------------------------
   One place, so a missing key produces one clear error rather than an
   `undefined` reaching a charge. Nothing is constructed at import time: the
   portal must still boot with no Stripe key at all, quoting prices and
   refusing to sell.
   ========================================================================== */

let client: Stripe | null = null;

export function stripeClient(): Stripe {
  const key = env.stripeSecretKey;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set; this call should not have been reached.");
  }
  client ??= new Stripe(key);
  return client;
}

export function stripeConfigured(): boolean {
  return Boolean(env.stripeSecretKey) && stripeMode() !== null;
}

/** Which set of price IDs to charge against. Throws only where already checked. */
export function requireStripeMode(): StripeMode {
  const mode = stripeMode();
  if (!mode) throw new Error("STRIPE_SECRET_KEY is missing or unrecognisable.");
  return mode;
}

/**
 * Payment method configurations, if the account has them.
 *
 * Two are needed because buy-now-pay-later cannot appear in Checkout's
 * subscription mode — so the pay-in-full button and the instalment button
 * cannot share one configuration. Both are optional: with neither set, Stripe
 * falls back to the account default, which is a reasonable card-only starting
 * point rather than a failure.
 */
export function paymentMethodConfiguration(plan: "full" | "instalments"): string | undefined {
  return (plan === "full" ? env.stripePmcFull : env.stripePmcInstalments) ?? undefined;
}
