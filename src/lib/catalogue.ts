/* ==========================================================================
   Pricing catalogue
   --------------------------------------------------------------------------
   What every SKU costs, in every currency the marketing site quotes. This is
   the source of truth for what is *charged*; the HTML price tables, the plan
   cards and the six copies of RATE_TIERS in the sub-sites are display, and a
   build-time checker holds them to these numbers rather than the other way
   round.

   Deliberately not `server-only`. The public checkout page reads it, the
   build step that bakes prices into the static site reads it, and the tests
   read it without a build. Nothing secret lives here — Stripe price IDs are
   public identifiers, and the secret key is in env.ts.

   Three rules govern every number below, and catalogue.test.mts enforces
   all three:

   1. The ladder is primary. The sub-sites say packages are "just convenient
      entry points, the math behind every one of them is the exact table
      above", so a package total is always hours x the ladder rate for its
      tier. Rounding the two independently would make the site's own claim
      false in three currencies out of four.

   2. Whole units only. Converted at the USD base rate, rounded up. No cents
      anywhere in a headline price.

   3. Instalments divide exactly, in every currency. A remainder would need a
      second subscription-schedule phase, and a schedule whose phases disagree
      about the amount is the kind of thing nobody notices until a customer is
      overcharged. Counts were chosen to satisfy this: 3 and 6 do not divide
      the rounded totals in every currency, 4 does, and Elite also takes 6.

   AUD is grossed up by 10% before rounding, because AUD prices are quoted
   GST-inclusive (Australian Consumer Law's single-price rule) and Australian
   sales carry 10% GST while exports of services do not. Without the gross-up
   an Australian buyer's net-of-GST price would sit ~9% below everyone else's.
   The GST inside an AUD price is always amount / 11.

   Rates are fixed by hand and reviewed quarterly, not fetched. A marketing
   price that moves with the spot rate is a marketing price nobody can quote.
   Last set 2026-09-07 at USD->EUR 0.86044, USD->GBP 0.73906, USD->AUD 1.3861.
   ========================================================================== */

import { STRIPE_PRICES, type StripeMode } from "./stripe-prices.generated";

export type { StripeMode };

export const CURRENCIES = ["usd", "eur", "gbp", "aud"] as const;
export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

/** Every amount in this file is whole major units of its currency. */
export type Money = Record<Currency, number>;

/* --------------------------------------------------------------------------
   Divisions
   --------------------------------------------------------------------------
   Each pathway quotes a home currency, matching who it is for. Location still
   wins when the visitor's own currency is one of the four — this is the
   fallback, and what a JS-disabled visitor sees.

   "own-your-atar" quotes AUD GST-inclusive, and its site now ships, so the
   checkout sees site=own-your-atar&ccy=aud on its CTAs rather than reaching
   Australian buyers by location alone.
   -------------------------------------------------------------------------- */

export const DIVISION_BASE: Readonly<Record<string, Currency>> = {
  "own-your-ib": "eur",
  "own-your-alevel-gcse": "gbp",
  "own-your-ap": "usd",
  "own-your-med-school": "usd",
  "own-your-uni-admission": "usd",
  "own-your-uni-studies": "usd",
  "own-your-atar": "aud",
};

export const FALLBACK_CURRENCY: Currency = "usd";

export function baseCurrencyFor(site: string | null | undefined): Currency {
  if (!site) return FALLBACK_CURRENCY;
  return DIVISION_BASE[site] ?? FALLBACK_CURRENCY;
}

/* --------------------------------------------------------------------------
   The rate ladder
   --------------------------------------------------------------------------
   Ordered high threshold first, so the first tier a given number of hours
   clears is its tier. USD is the published ladder; the rest are converted and
   rounded up, AUD after its GST gross-up.
   -------------------------------------------------------------------------- */

export interface LadderTier {
  minHours: number;
  rate: Money;
}

/**
 * The undiscounted rate, named rather than inlined so ladderRate() has a
 * defined answer for hours below the bottom tier instead of an index that the
 * compiler has to be talked out of.
 */
export const TOP_RATE: Money = { usd: 80, eur: 69, gbp: 60, aud: 122 };

export const RATE_LADDER: readonly LadderTier[] = [
  { minHours: 40, rate: { usd: 60, eur: 52, gbp: 45, aud: 92 } },
  { minHours: 20, rate: { usd: 66, eur: 57, gbp: 49, aud: 101 } },
  { minHours: 10, rate: { usd: 72, eur: 62, gbp: 54, aud: 110 } },
  { minHours: 5, rate: { usd: 78, eur: 68, gbp: 58, aud: 119 } },
  { minHours: 1, rate: TOP_RATE },
];

/** The hourly rate a given number of hours earns. Below one hour, the top rate. */
export function ladderRate(hours: number, currency: Currency): number {
  const tier = RATE_LADDER.find((t) => hours >= t.minHours);
  return (tier?.rate ?? TOP_RATE)[currency];
}

/* --------------------------------------------------------------------------
   SKUs
   -------------------------------------------------------------------------- */

export type SkuGroup = "tutoring" | "summer" | "module";

export interface Instalments {
  /** Number of monthly charges. amounts[c] / months is always a whole number. */
  months: number;
}

export interface Sku {
  slug: string;
  name: string;
  blurb: string;
  group: SkuGroup;
  /** Full price, whole major units. AUD is GST-inclusive. */
  amounts: Money;
  /** Instructional hours, or null for a flat-fee deliverable. */
  hours: number | null;
  /** Whether Checkout should let the buyer change the quantity. */
  quantityAdjustable: boolean;
  /**
   * What buying it entitles the buyer to. Only the question bank grants
   * anything directly: the >=20 hour packages already earn it through the
   * pooled-hours rule in has_question_bank_access(), and duplicating that
   * here would be a second source of truth for the same entitlement.
   */
  grants: { questionBankDays: number } | null;
  /** IB is the only sub-site that ships question banks. */
  ibOnly: boolean;
  instalments: Instalments | null;
}

export const CATALOGUE: readonly Sku[] = [
  {
    slug: "single-session",
    name: "Single Session",
    blurb: "One hour, no commitment. A trial or a one-off piece of prep.",
    group: "tutoring",
    amounts: { usd: 80, eur: 69, gbp: 60, aud: 122 },
    hours: 1,
    quantityAdjustable: true,
    grants: null,
    ibOnly: false,
    instalments: null,
  },
  {
    slug: "starter-5hr",
    name: "Starter Pack",
    blurb: "Five hours, for topic-specific gaps. Valid two months.",
    group: "tutoring",
    amounts: { usd: 390, eur: 340, gbp: 290, aud: 595 },
    hours: 5,
    quantityAdjustable: false,
    grants: null,
    ibOnly: false,
    instalments: null,
  },
  {
    slug: "standard-10hr",
    name: "Standard Pack",
    blurb: "Ten hours with priority scheduling. Valid three months.",
    group: "tutoring",
    amounts: { usd: 720, eur: 620, gbp: 540, aud: 1100 },
    hours: 10,
    quantityAdjustable: false,
    grants: null,
    ibOnly: false,
    instalments: null,
  },
  {
    slug: "committed-20hr",
    name: "Committed Pack",
    blurb: "Twenty hours, a full strategy plan, and question bank access.",
    group: "tutoring",
    amounts: { usd: 1320, eur: 1140, gbp: 980, aud: 2020 },
    hours: 20,
    quantityAdjustable: false,
    grants: null,
    ibOnly: false,
    instalments: { months: 4 },
  },
  {
    slug: "foundation-10s",
    name: "Foundation Program",
    blurb: "Ten summer sessions, twenty hours.",
    group: "summer",
    amounts: { usd: 1320, eur: 1140, gbp: 980, aud: 2020 },
    hours: 20,
    quantityAdjustable: false,
    grants: null,
    ibOnly: false,
    instalments: { months: 4 },
  },
  {
    slug: "momentum-20s",
    name: "Momentum Program",
    blurb: "Twenty summer sessions, forty hours, at the rate floor.",
    group: "summer",
    amounts: { usd: 2400, eur: 2080, gbp: 1800, aud: 3680 },
    hours: 40,
    quantityAdjustable: false,
    grants: null,
    ibOnly: false,
    instalments: { months: 4 },
  },
  {
    slug: "achiever-40s",
    name: "Achiever Program",
    blurb: "Forty summer sessions, eighty hours.",
    group: "summer",
    amounts: { usd: 4800, eur: 4160, gbp: 3600, aud: 7360 },
    hours: 80,
    quantityAdjustable: false,
    grants: null,
    ibOnly: false,
    instalments: { months: 4 },
  },
  {
    slug: "elite-60s",
    name: "Elite Program",
    blurb: "Sixty summer sessions, a hundred and twenty hours.",
    group: "summer",
    amounts: { usd: 7200, eur: 6240, gbp: 5400, aud: 11040 },
    hours: 120,
    quantityAdjustable: false,
    grants: null,
    ibOnly: false,
    // Six, not four: the largest ticket earns the gentlest monthly, and 6
    // happens to divide 7200/6240/5400/11040 exactly where it does not
    // divide the smaller packages.
    instalments: { months: 6 },
  },
  {
    slug: "ia-strategy",
    name: "IA & EE Strategy Package",
    blurb: "Six hours on internal assessment and the extended essay.",
    group: "module",
    amounts: { usd: 468, eur: 408, gbp: 348, aud: 714 },
    hours: 6,
    quantityAdjustable: false,
    grants: null,
    ibOnly: false,
    instalments: null,
  },
  {
    slug: "exam-strategy",
    name: "Exam Strategy & Mentoring Block",
    blurb: "Eight hours of exam technique and mentoring.",
    group: "module",
    amounts: { usd: 624, eur: 544, gbp: 464, aud: 952 },
    hours: 8,
    quantityAdjustable: false,
    grants: null,
    ibOnly: false,
    instalments: null,
  },
  {
    slug: "mock-exam",
    name: "Mock Exam Sitting",
    blurb: "One sat mock, marked and debriefed.",
    group: "module",
    amounts: { usd: 160, eur: 138, gbp: 120, aud: 244 },
    hours: 2,
    quantityAdjustable: true,
    grants: null,
    ibOnly: false,
    instalments: null,
  },
  {
    slug: "profile-review",
    name: "University Academic Profile Review",
    blurb: "A one-time review against target university requirements.",
    group: "module",
    amounts: { usd: 150, eur: 130, gbp: 111, aud: 229 },
    hours: null,
    quantityAdjustable: false,
    grants: null,
    ibOnly: false,
    instalments: null,
  },
  {
    slug: "question-bank",
    name: "Question Bank Access",
    blurb: "A year of the question banks and the mock papers.",
    group: "module",
    amounts: { usd: 120, eur: 104, gbp: 89, aud: 183 },
    hours: null,
    quantityAdjustable: false,
    // The only SKU that grants an entitlement outright. Also the reason it has
    // no instalment option: the first payment would hand over the content.
    grants: { questionBankDays: 365 },
    ibOnly: true,
    instalments: null,
  },
];

/* --------------------------------------------------------------------------
   Lookups
   --------------------------------------------------------------------------
   skuFor returning null rather than throwing is what lets the checkout route
   treat an unknown slug as a 400 instead of a crash: "../" and junk are simply
   not keys, the same defence the question bank routes use.
   -------------------------------------------------------------------------- */

const BY_SLUG = new Map(CATALOGUE.map((sku) => [sku.slug, sku]));

export function skuFor(slug: string | null | undefined): Sku | null {
  if (!slug) return null;
  return BY_SLUG.get(slug) ?? null;
}

export type Plan = "full" | "instalments";

/** What a single charge costs: the whole price, or one instalment of it. */
export function amountFor(sku: Sku, currency: Currency, plan: Plan = "full"): number {
  const total = sku.amounts[currency];
  if (plan === "full" || !sku.instalments) return total;
  return total / sku.instalments.months;
}

/**
 * The Stripe price to charge against, or null when setup-stripe.mjs has not
 * created it yet. Mode is passed in rather than read from the environment:
 * this module is also consumed by the static site's build step, which has no
 * Stripe key and no business knowing about one.
 */
export function priceIdFor(sku: Sku, plan: Plan, mode: StripeMode): string | null {
  const entry = STRIPE_PRICES[sku.slug];
  if (!entry) return null;
  const ref = plan === "instalments" ? entry.instalments : entry.full;
  return ref?.[mode] ?? null;
}

/** Whether every price this SKU can be sold at exists in the given mode. */
export function isSellable(sku: Sku, mode: StripeMode): boolean {
  if (!priceIdFor(sku, "full", mode)) return false;
  return !sku.instalments || Boolean(priceIdFor(sku, "instalments", mode));
}

export function offersInstalments(sku: Sku): boolean {
  return sku.instalments !== null;
}

/** Stripe works in minor units. Every currency here has two decimal places. */
export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

/* --------------------------------------------------------------------------
   GST
   --------------------------------------------------------------------------
   Only AUD carries it, and only ever inclusively, so the tax inside a price is
   the price over eleven. Stripe Tax is what actually decides whether a given
   sale is taxable — this is for display, not for the return.
   -------------------------------------------------------------------------- */

export const GST_RATE = 0.1;

export function gstComponent(audAmount: number): number {
  return audAmount / 11;
}

/**
 * The Stripe Tax product code, which decides *who* pays GST.
 *
 * This is not a formality. Stripe treats "Educational Services" and "Tutoring"
 * as services performed at the seller's location, so an Australian seller
 * charges 10% GST to a student in London, New York and Berlin alike. Verified
 * against Stripe's tax calculation API — those two codes return GST for every
 * buyer country tested; the remote-delivery codes below return it only for AU.
 *
 * Everything here is delivered online to a student who is not in Australia, so
 * the remote codes are the ones that describe what is actually sold:
 *
 *   hours !== null   live sessions over video, however they are packaged
 *   question-bank    written content the student works through unaided
 *   profile-review   a written review returned by email, no session
 *
 * The consequence of getting it wrong is not a rounding error: the account
 * default alone would have declared roughly a ninth of all worldwide revenue
 * as GST owed to the ATO.
 *
 * A tax code is a tax position. This one is the honest description of the
 * service; whether the ATO agrees is a question for an accountant.
 */
export function taxCodeFor(sku: Sku): string {
  if (sku.hours !== null) return "txcd_20060045"; // Training Services - Live Virtual
  if (sku.grants) return "txcd_20060058"; // Training Services - Self-study Web-based
  return "txcd_20060000"; // Professional Services
}

/* --------------------------------------------------------------------------
   Formatting
   --------------------------------------------------------------------------
   No fraction digits, because every catalogue amount is a whole unit and a
   trailing ".00" on a marketing page reads as a mistake. Instalment amounts
   are whole by construction too.
   -------------------------------------------------------------------------- */

const LOCALE_FOR: Record<Currency, string> = {
  usd: "en-US",
  eur: "en-IE",
  gbp: "en-GB",
  aud: "en-AU",
};

export function formatMoney(amount: number, currency: Currency): string {
  return new Intl.NumberFormat(LOCALE_FOR[currency], {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amount);
}
