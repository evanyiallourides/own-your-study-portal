import "server-only";

import { env } from "@/lib/env";
import type { Currency } from "@/lib/catalogue";

/* ==========================================================================
   Wise local receiving accounts
   --------------------------------------------------------------------------
   The decision this file encodes: for every currency Stripe cannot yet debit
   cheaply for this business (see bank-debit.ts — USD has no scheme at all,
   EUR/GBP are built but unactivated), a buyer instead sends a direct bank
   transfer into one of this business's Wise local-currency accounts.

   v1 supports exactly the three non-AUD currencies this site quotes in — usd,
   eur, gbp — matched one-to-one to a Wise account in that same currency. A
   buyer whose bank does not hold one of these three sends the converted
   equivalent and lets their own bank do the conversion; Wise also supports
   local receiving in many more currencies, but offering those here would need
   either a live FX rate at checkout or an amount-tolerance match on the
   webhook side, neither of which this file takes on.

   Account details are real financial data, not sample text, so they live in
   the environment rather than in source — the same handling as the Stripe
   secret key. Computed fresh on every call rather than cached at module load,
   because unlike bank-debit.ts's BY_CURRENCY (which really is public,
   non-secret metadata), these values come from env.ts's live getters and must
   react the same way they do — nothing here is fixed at import time.
   ========================================================================== */

export interface WiseAccount {
  currency: Currency;
  /** What a buyer sees it called, e.g. "UK bank transfer (Faster Payments)". */
  label: string;
  accountHolder: string;
  /** Shown as-is, one line each: account number, sort code/IBAN, SWIFT/BIC — whatever this currency's scheme needs. */
  details: string[];
}

const LABELS: Partial<Record<Currency, string>> = {
  usd: "US bank transfer (ACH)",
  eur: "European bank transfer (SEPA)",
  gbp: "UK bank transfer (Faster Payments)",
};

function rawDetailsFor(currency: Currency): string | null {
  switch (currency) {
    case "usd":
      return env.wiseUsdAccountDetails;
    case "eur":
      return env.wiseEurAccountDetails;
    case "gbp":
      return env.wiseGbpAccountDetails;
    case "aud":
      return null; // AUD stays on Stripe — see provider.ts.
  }
}

/** The Wise account for a currency, or null if it is not set up yet. */
export function wiseAccountFor(currency: Currency): WiseAccount | null {
  const label = LABELS[currency];
  const holder = env.wiseAccountHolder;
  const raw = rawDetailsFor(currency);
  if (!label || !holder || !raw) return null;

  const details = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return { currency, label, accountHolder: holder, details };
}

/** Why a buyer cannot pay this way yet, in words meant for the buyer. */
export function explainWiseRefusal(currency: Currency): string {
  return (
    `We take payment for ${currency.toUpperCase()} by direct bank transfer via Wise, and ` +
    `that account is still being set up. Get in touch and we will arrange payment another way.`
  );
}
