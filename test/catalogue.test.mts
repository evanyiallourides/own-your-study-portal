import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CATALOGUE,
  CURRENCIES,
  DIVISION_BASE,
  RATE_LADDER,
  amountFor,
  baseCurrencyFor,
  formatMoney,
  gstComponent,
  isCurrency,
  ladderRate,
  offersInstalments,
  isSellable,
  priceIdFor,
  skuFor,
  taxCodeFor,
  toMinorUnits,
  type Currency,
} from "@/lib/catalogue";
import { STRIPE_PRICES } from "@/lib/stripe-prices.generated";

/* ==========================================================================
   Pricing catalogue
   --------------------------------------------------------------------------
   Four currencies times fourteen SKUs is more numbers than anyone can hold in
   their head, and every one of them is money. These are the rules that made
   those numbers what they are; the point of writing them down as tests is that
   the next person to edit a price cannot quietly break one.

   The three that matter most:

     - a package total is hours x the ladder rate, because the sub-sites tell
       visitors it is;
     - an instalment total divides exactly, because a remainder would need a
       second schedule phase and phases that disagree overcharge people;
     - AUD is grossed up before rounding, because it is quoted GST-inclusive
       and without the gross-up Australian sales net ~9% less than the rest.

   The exchange rates below are the ones the catalogue was built from. They are
   here so the AUD gross-up can be checked arithmetically rather than trusted.
   ========================================================================== */

const FX: Record<Currency, number> = {
  usd: 1,
  eur: 0.86044,
  gbp: 0.73906,
  aud: 1.3861,
};

const GST_MULTIPLIER = 1.1;

function isWholeAndPositive(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

/** Consecutive pairs, so the ordering checks below need no index arithmetic. */
function consecutive<T>(items: readonly T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 1; i < items.length; i += 1) {
    const previous = items[i - 1];
    const current = items[i];
    if (previous !== undefined && current !== undefined) out.push([previous, current]);
  }
  return out;
}

describe("currencies", () => {
  it("recognises the four it supports and nothing else", () => {
    for (const c of CURRENCIES) assert.ok(isCurrency(c));
    for (const junk of ["cad", "USD", "", "eur ", null, undefined, 42]) {
      assert.equal(isCurrency(junk), false, `${String(junk)} should not be a currency`);
    }
  });
});

describe("rate ladder", () => {
  it("is ordered so the first tier a number of hours clears is its tier", () => {
    for (const [higher, lower] of consecutive(RATE_LADDER)) {
      assert.ok(
        higher.minHours > lower.minHours,
        "tiers must descend, or ladderRate()'s find() picks the wrong one",
      );
    }
  });

  it("quotes a whole positive rate in every currency", () => {
    for (const tier of RATE_LADDER) {
      for (const c of CURRENCIES) {
        assert.ok(
          isWholeAndPositive(tier.rate[c]),
          `${tier.minHours}+ hrs in ${c} is ${tier.rate[c]}, not a whole positive number`,
        );
      }
    }
  });

  it("never charges more per hour for buying more hours", () => {
    for (const c of CURRENCIES) {
      for (const [more, fewer] of consecutive(RATE_LADDER)) {
        assert.ok(
          more.rate[c] <= fewer.rate[c],
          `${c}: ${more.minHours}+ hrs costs more per hour than ${fewer.minHours}+`,
        );
      }
    }
  });

  it("converts and rounds up from the published USD ladder", () => {
    for (const tier of RATE_LADDER) {
      for (const c of CURRENCIES) {
        if (c === "usd") continue;
        const gross = c === "aud" ? GST_MULTIPLIER : 1;
        assert.equal(
          tier.rate[c],
          Math.ceil(tier.rate.usd * FX[c] * gross - 1e-9),
          `${tier.minHours}+ hrs in ${c} is not the USD rate converted and rounded up`,
        );
      }
    }
  });

  it("grosses AUD up so an Australian sale nets no less than a USD one", () => {
    // The regression this guards: dropping the x1.1 would still round, still
    // look plausible, and quietly discount every Australian sale by ~9%.
    for (const tier of RATE_LADDER) {
      const netOfGst = tier.rate.aud / GST_MULTIPLIER;
      assert.ok(
        netOfGst / FX.aud >= tier.rate.usd,
        `${tier.minHours}+ hrs: A$${tier.rate.aud} nets US$${(netOfGst / FX.aud).toFixed(2)}, below US$${tier.rate.usd}`,
      );
    }
  });

  it("picks a tier for any number of hours", () => {
    assert.equal(ladderRate(1, "usd"), 80);
    assert.equal(ladderRate(4, "usd"), 80);
    assert.equal(ladderRate(5, "usd"), 78);
    assert.equal(ladderRate(20, "usd"), 66);
    assert.equal(ladderRate(120, "usd"), 60);
    assert.equal(ladderRate(0, "usd"), 80, "below the bottom tier still needs an answer");
  });
});

describe("catalogue", () => {
  it("has no duplicate slugs", () => {
    const slugs = CATALOGUE.map((s) => s.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });

  it("prices every SKU in every currency, in whole units", () => {
    for (const sku of CATALOGUE) {
      for (const c of CURRENCIES) {
        assert.ok(
          isWholeAndPositive(sku.amounts[c]),
          `${sku.slug} in ${c} is ${sku.amounts[c]}, not a whole positive number`,
        );
      }
    }
  });

  it("charges hours x the ladder rate for every hours-based SKU", () => {
    // The sub-sites say the packages are "just convenient entry points, the
    // math behind every one of them is the exact table above". This is what
    // makes that sentence true rather than nearly true.
    for (const sku of CATALOGUE) {
      if (sku.hours === null) continue;
      for (const c of CURRENCIES) {
        assert.equal(
          sku.amounts[c],
          sku.hours * ladderRate(sku.hours, c),
          `${sku.slug} in ${c}: ${sku.amounts[c]} is not ${sku.hours} x ${ladderRate(sku.hours, c)}`,
        );
      }
    }
  });

  it("converts and rounds up the flat-fee SKUs too", () => {
    for (const sku of CATALOGUE) {
      if (sku.hours !== null) continue;
      for (const c of CURRENCIES) {
        if (c === "usd") continue;
        const gross = c === "aud" ? GST_MULTIPLIER : 1;
        assert.equal(
          sku.amounts[c],
          Math.ceil(sku.amounts.usd * FX[c] * gross - 1e-9),
          `${sku.slug} in ${c} is not the USD price converted and rounded up`,
        );
      }
    }
  });

  it("divides every instalment plan exactly, in every currency", () => {
    // A remainder would need a second subscription-schedule phase. Choosing the
    // month count to avoid one is why Committed is 4 rather than 3 and Achiever
    // is 4 rather than 6.
    for (const sku of CATALOGUE) {
      if (!sku.instalments) continue;
      const { months } = sku.instalments;
      assert.ok(months >= 2, `${sku.slug}: ${months} instalments is not a plan`);
      for (const c of CURRENCIES) {
        assert.equal(
          sku.amounts[c] % months,
          0,
          `${sku.slug} in ${c}: ${sku.amounts[c]} / ${months} leaves ${sku.amounts[c] % months}`,
        );
      }
    }
  });

  it("only offers instalments where the ticket justifies the fees and the risk", () => {
    for (const sku of CATALOGUE) {
      if (!sku.instalments) continue;
      assert.ok(
        sku.amounts.usd >= 1000,
        `${sku.slug} at US$${sku.amounts.usd} is too small to be worth instalment fees`,
      );
    }
  });

  it("grants an entitlement from exactly one SKU", () => {
    // question_bank_access is written by a webhook for this SKU alone. The >=20
    // hour packages reach the same entitlement through pooled hours, in SQL; a
    // grant here as well would be a second source of truth for one fact.
    const granting = CATALOGUE.filter((s) => s.grants !== null);
    assert.deepEqual(
      granting.map((s) => s.slug),
      ["question-bank"],
    );
    const bank = granting[0];
    assert.ok(bank);
    assert.equal(bank.grants?.questionBankDays, 365);
  });

  it("sells the question bank only from the sub-site that ships it", () => {
    const ibOnly = CATALOGUE.filter((s) => s.ibOnly).map((s) => s.slug);
    assert.deepEqual(ibOnly, ["question-bank"]);
  });

  it("never offers instalments on content handed over at the first payment", () => {
    const bank = skuFor("question-bank");
    assert.ok(bank);
    assert.equal(offersInstalments(bank), false);
  });

  it("only records Stripe prices against slugs that exist", () => {
    for (const slug of Object.keys(STRIPE_PRICES)) {
      assert.ok(skuFor(slug), `STRIPE_PRICES has ${slug}, which is not in the catalogue`);
    }
  });

  it("never records an instalment price for a SKU sold only outright", () => {
    for (const [slug, prices] of Object.entries(STRIPE_PRICES)) {
      if (!prices.instalments) continue;
      const sku = skuFor(slug);
      assert.ok(sku?.instalments, `${slug} has an instalment price but no instalment plan`);
    }
  });

  it("gives no two SKUs the same Stripe price ID", () => {
    // Two SKUs sharing an ID would charge one price and record the other, and
    // the mistake would show up as a reconciliation discrepancy weeks later.
    const ids = Object.values(STRIPE_PRICES).flatMap((p) =>
      [p.full?.test, p.full?.live, p.instalments?.test, p.instalments?.live].filter(
        (id): id is string => typeof id === "string",
      ),
    );
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("lookups", () => {
  it("returns null for anything that is not a slug", () => {
    // The checkout route turns this null into a 400, which is why path
    // traversal and junk never reach Stripe.
    for (const junk of ["", "../../etc/passwd", "Committed-20hr", null, undefined]) {
      assert.equal(skuFor(junk), null, `${String(junk)} should not resolve`);
    }
    assert.ok(skuFor("committed-20hr"));
  });

  it("gives the whole price for a full payment and one charge for a plan", () => {
    const elite = skuFor("elite-60s");
    assert.ok(elite);
    assert.equal(amountFor(elite, "usd", "full"), 7200);
    assert.equal(amountFor(elite, "usd", "instalments"), 1200);
    assert.equal(amountFor(elite, "aud", "instalments"), 1840);

    const starter = skuFor("starter-5hr");
    assert.ok(starter);
    assert.equal(
      amountFor(starter, "usd", "instalments"),
      390,
      "asking for instalments on a SKU without a plan should give the full price, not NaN",
    );
  });

  it("reports no price, rather than a wrong one, before the setup script runs", () => {
    // isSellable is what the checkout route asks before it offers a button, so
    // an unconfigured SKU has to read as unsellable rather than throw at Stripe.
    const committed = skuFor("committed-20hr");
    assert.ok(committed);
    for (const mode of ["test", "live"] as const) {
      if (priceIdFor(committed, "full", mode) === null) {
        assert.equal(isSellable(committed, mode), false);
      }
    }
  });

  it("treats a SKU with an outright price but no instalment price as unsellable", () => {
    // Half-configured is the dangerous state: the Pay in full button works, the
    // instalment button 500s, and only one of them is on the happy path.
    const elite = skuFor("elite-60s");
    assert.ok(elite);
    assert.ok(elite.instalments);
    const configured = STRIPE_PRICES["elite-60s"];
    if (configured?.full?.test && !configured.instalments?.test) {
      assert.equal(isSellable(elite, "test"), false);
    }
  });
});

describe("divisions", () => {
  it("gives each pathway the currency of the people it is for", () => {
    assert.equal(baseCurrencyFor("own-your-ib"), "eur");
    assert.equal(baseCurrencyFor("own-your-alevel-gcse"), "gbp");
    assert.equal(baseCurrencyFor("own-your-ap"), "usd");
    assert.equal(baseCurrencyFor("own-your-atar"), "aud");
  });

  it("falls back to USD for an unknown or missing sub-site", () => {
    assert.equal(baseCurrencyFor("own-your-nothing"), "usd");
    assert.equal(baseCurrencyFor(null), "usd");
    assert.equal(baseCurrencyFor(undefined), "usd");
  });

  it("names only currencies it can actually price in", () => {
    for (const [site, ccy] of Object.entries(DIVISION_BASE)) {
      assert.ok(isCurrency(ccy), `${site} maps to ${ccy}, which is not a supported currency`);
    }
  });
});

describe("money", () => {
  it("converts to the minor units Stripe wants", () => {
    assert.equal(toMinorUnits(1320), 132000);
    assert.equal(toMinorUnits(89), 8900);
  });

  it("takes GST out of an inclusive AUD price", () => {
    assert.equal(gstComponent(11), 1);
    assert.ok(Math.abs(gstComponent(2020) - 183.636) < 0.01);
  });

  it("formats without decimals, because every amount is whole", () => {
    for (const c of CURRENCIES) {
      assert.ok(
        !formatMoney(1320, c).includes("."),
        `${c} formatted with a decimal point: ${formatMoney(1320, c)}`,
      );
    }
  });
});

describe("tax codes", () => {
  /* Stripe treats these two as services performed where the seller is, which
     for an Australian company means 10% GST on a student in London. Confirmed
     against Stripe's calculation API, not inferred from the names. Nothing sold
     here is delivered in a room in Australia. */
  const TAXED_AT_ORIGIN = new Set([
    "txcd_20060052", // Educational Services
    "txcd_20060059", // Tutoring
  ]);

  it("never puts a SKU on a code that taxes overseas students", () => {
    for (const sku of CATALOGUE) {
      const code = taxCodeFor(sku);
      assert.ok(
        !TAXED_AT_ORIGIN.has(code),
        `${sku.slug} is on ${code}, which charges GST to every buyer on earth`,
      );
    }
  });

  it("gives every SKU a code", () => {
    for (const sku of CATALOGUE) {
      assert.match(taxCodeFor(sku), /^txcd_[0-9]+$/, `${sku.slug} has no usable tax code`);
    }
  });

  it("separates live teaching from written deliverables", () => {
    assert.equal(taxCodeFor(skuFor("elite-60s")!), "txcd_20060045", "120 hours of live sessions");
    assert.equal(taxCodeFor(skuFor("single-session")!), "txcd_20060045", "one live hour");
    assert.equal(taxCodeFor(skuFor("question-bank")!), "txcd_20060058", "worked through unaided");
    assert.equal(taxCodeFor(skuFor("profile-review")!), "txcd_20060000", "returned by email");
  });
});
