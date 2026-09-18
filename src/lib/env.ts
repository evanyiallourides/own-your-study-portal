/* ==========================================================================
   Environment
   --------------------------------------------------------------------------
   Read in one place so a missing variable produces one clear message rather
   than an undefined creeping into a fetch call. Nothing here is validated at
   import time: the portal must still boot in demo mode with no keys at all.
   ========================================================================== */

import type { StripeMode } from "@/lib/stripe-prices.generated";

const read = (name: string): string | null => {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : null;
};

/* Referenced by their full name rather than through a helper, because Next
   only inlines NEXT_PUBLIC_* variables it can see literally in the source. */
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL.trim() !== ""
    ? process.env.NEXT_PUBLIC_SUPABASE_URL.trim()
    : null;

const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim() !== ""
    ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim()
    : null;

const DEMO_FLAG =
  process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === "true" ||
  process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === "1";

export const env = {
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
  get supabaseServiceRoleKey() {
    return read("SUPABASE_SERVICE_ROLE_KEY");
  },
  get openaiApiKey() {
    return read("OPENAI_API_KEY");
  },
  get openaiModel() {
    return read("OPENAI_MODEL") ?? "gpt-4.1";
  },
  get recallApiKey() {
    return read("RECALL_API_KEY");
  },
  get recallRegion() {
    return read("RECALL_REGION") ?? "us-west-2";
  },
  get recallWebhookSecret() {
    return read("RECALL_WEBHOOK_SECRET");
  },
  get googleClientId() {
    return read("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret() {
    return read("GOOGLE_CLIENT_SECRET");
  },
  get stripeSecretKey() {
    return read("STRIPE_SECRET_KEY");
  },
  get stripeWebhookSecret() {
    return read("STRIPE_WEBHOOK_SECRET");
  },
  /* Optional. Buy-now-pay-later cannot appear in Checkout's subscription mode,
     so pay-in-full and instalments need separate payment method
     configurations. Unset, Stripe uses the account default. */
  get stripePmcFull() {
    return read("STRIPE_PMC_FULL");
  },
  get stripePmcInstalments() {
    return read("STRIPE_PMC_INSTALMENTS");
  },
  get wiseApiToken() {
    return read("WISE_API_TOKEN");
  },
  /* Wise signs each webhook delivery with its own RSA key and sends the
     signature in the X-Signature-SHA256 header — an asymmetric scheme, unlike
     Stripe's shared signing secret, so what belongs here is the PUBLIC half:
     the exact PEM Wise publishes for verifying deliveries (sandbox and live
     keys differ). Copy it from Wise's current webhook documentation rather
     than reusing any value written here before — Wise can rotate it. */
  get wiseWebhookPublicKey() {
    return read("WISE_WEBHOOK_PUBLIC_KEY");
  },
  get wiseSandbox() {
    return read("WISE_SANDBOX") === "true";
  },
  /* The name on the receiving account, shared across every currency — a Wise
     Business account has one legal holder regardless of how many currency
     balances it keeps. */
  get wiseAccountHolder() {
    return read("WISE_ACCOUNT_HOLDER");
  },
  get wiseUsdAccountDetails() {
    return read("WISE_USD_ACCOUNT_DETAILS");
  },
  get wiseEurAccountDetails() {
    return read("WISE_EUR_ACCOUNT_DETAILS");
  },
  get wiseGbpAccountDetails() {
    return read("WISE_GBP_ACCOUNT_DETAILS");
  },
  get appUrl() {
    return read("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000";
  },
  get marketingSiteUrl() {
    return read("NEXT_PUBLIC_MARKETING_URL") ?? "https://ownyourstudy.com";
  },
} as const;

/**
 * Demo mode is the state the portal runs in when no database is configured —
 * or when it is explicitly asked for. It serves a fixed in-memory dataset so
 * every screen, state and role can be seen without an account. It is loudly
 * labelled in the UI, and it refuses to start if Supabase credentials are
 * present unless the flag is set on purpose.
 */
export function isDemoMode(): boolean {
  if (DEMO_FLAG) return true;
  return !(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/**
 * Whether the paid question banks and mock papers may be served at all.
 *
 * Demo mode has no authentication worth the name: its login page hands any role
 * to anyone who clicks, and tutors pass the paid-content gate. A portal
 * deployed without its Supabase secrets falls back to demo mode — so without
 * this, a first deploy would publish every question and every paper to whoever
 * picked the tutor account.
 *
 * Set PORTAL_DEMO_PAID_CONTENT=true to open it locally on purpose.
 */
export function paidContentAvailable(): boolean {
  return !isDemoMode() || process.env.PORTAL_DEMO_PAID_CONTENT === "true";
}

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/** Integrations report their own readiness so the UI can say what is wired up
 *  rather than pretending everything is. */
export interface IntegrationStatus {
  configured: boolean;
  detail: string;
}

export function openAiStatus(): IntegrationStatus {
  return env.openaiApiKey
    ? { configured: true, detail: `Ready — model ${env.openaiModel}` }
    : { configured: false, detail: "No OPENAI_API_KEY set. Lesson analysis will not run." };
}

export function googleStatus(): IntegrationStatus {
  if (!env.googleClientId || !env.googleClientSecret) {
    return {
      configured: false,
      detail:
        "No GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set. Meet links must be pasted in by hand.",
    };
  }
  return { configured: true, detail: "Ready — tutors can connect their Google Calendar." };
}

/**
 * Which set of Stripe prices to charge against, read from the key itself.
 *
 * Test and live are separate worlds with separate price IDs, and the usual way
 * to get this wrong is a stale STRIPE_MODE variable left pointing at test while
 * a live key is in place — which fails by taking real money against a price
 * that does not exist. The key already knows; nothing else gets a vote.
 */
export function stripeMode(): StripeMode | null {
  const key = env.stripeSecretKey;
  if (!key) return null;
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  return null;
}

export function paymentsStatus(): IntegrationStatus {
  const key = env.stripeSecretKey;
  if (!key) {
    return {
      configured: false,
      detail: "No STRIPE_SECRET_KEY set. The site can quote prices but cannot take payment.",
    };
  }
  const mode = stripeMode();
  if (!mode) {
    return {
      configured: false,
      detail: "STRIPE_SECRET_KEY is not a recognisable secret key. Expected sk_test_… or sk_live_…",
    };
  }
  if (!env.stripeWebhookSecret) {
    return {
      configured: false,
      detail:
        `Stripe key is ${mode} mode, but no STRIPE_WEBHOOK_SECRET is set. ` +
        "Payments would be taken and never recorded, which is the worst of both.",
    };
  }
  return {
    configured: true,
    detail:
      mode === "live"
        ? "Ready — LIVE mode. Charges are real."
        : "Ready — test mode. No real money moves.",
  };
}

export function wiseStatus(): IntegrationStatus {
  if (!env.wiseApiToken) {
    return {
      configured: false,
      detail: "No WISE_API_TOKEN set. USD/EUR/GBP orders can be quoted but not taken.",
    };
  }
  if (!env.wiseWebhookPublicKey) {
    return {
      configured: false,
      detail:
        "Wise API token is set, but no WISE_WEBHOOK_PUBLIC_KEY is set. " +
        "Transfers would arrive and never be recorded, which is the worst of both.",
    };
  }
  return {
    configured: true,
    detail: env.wiseSandbox
      ? "Ready — sandbox mode. No real money moves."
      : "Ready — live mode. Transfers are real.",
  };
}

export function recallStatus(): IntegrationStatus {
  return env.recallApiKey
    ? { configured: true, detail: `Ready — region ${env.recallRegion}` }
    : {
        configured: false,
        detail: "No RECALL_API_KEY set. The notetaker cannot be scheduled into meetings.",
      };
}
