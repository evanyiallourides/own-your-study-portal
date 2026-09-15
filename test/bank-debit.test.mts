import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CATALOGUE, CURRENCIES, amountFor, offersPayInFull, skuFor } from "@/lib/catalogue";
import { bankDebitFor, explainRefusal, schemeFor } from "@/lib/payments/bank-debit";

describe("bank debit availability", () => {
  it("has no scheme for USD, because Australia cannot accept ACH", () => {
    assert.equal(schemeFor("usd"), null);
    const r = bankDebitFor("usd", 100);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, "no_scheme");
  });

  it("refuses a currency whose scheme is not switched on yet", () => {
    for (const ccy of ["eur", "gbp"] as const) {
      const scheme = schemeFor(ccy);
      assert.ok(scheme, `${ccy} should name a scheme even before it is activated`);
      if (scheme.activated) continue; // flipped on in the Dashboard; nothing to assert
      const r = bankDebitFor(ccy, 100);
      assert.equal(r.ok, false, `${ccy} is not activated, so it must refuse`);
      assert.equal(r.ok === false && r.reason, "not_activated");
    }
  });

  it("takes AUD through PayTo today", () => {
    const r = bankDebitFor("aud", 183);
    assert.equal(r.ok, true);
    assert.equal(r.ok === true && r.scheme.method, "payto");
  });

  it("refuses a charge over the scheme ceiling rather than letting Stripe reject it", () => {
    assert.equal(bankDebitFor("aud", 10_000).ok, true, "the limit itself is allowed");
    const over = bankDebitFor("aud", 10_001);
    assert.equal(over.ok, false);
    assert.equal(over.ok === false && over.reason, "over_limit");
  });

  it("explains every refusal in words aimed at the buyer", () => {
    for (const reason of ["no_scheme", "not_activated", "over_limit"] as const) {
      const text = explainRefusal(reason, schemeFor("aud"), "aud");
      assert.ok(text.length > 40, `${reason} produced a stub`);
      assert.ok(!/undefined|null|NaN/.test(text), `${reason} leaked a placeholder: ${text}`);
    }
  });
});

describe("what is actually sellable under bank debit", () => {
  /* The failure this guards against is silent: a price rises past a scheme's
     ceiling, the button disappears, and nobody notices until the sales stop. */
  it("leaves every instalment charge inside its scheme's ceiling", () => {
    for (const sku of CATALOGUE.filter((s) => s.instalments)) {
      for (const ccy of CURRENCIES) {
        const scheme = schemeFor(ccy);
        if (!scheme) continue;
        const per = amountFor(sku, ccy, "instalments");
        assert.ok(
          per <= scheme.limit,
          `${sku.slug} bills ${per} ${ccy.toUpperCase()} a month, over ${scheme.label}'s ${scheme.limit}`,
        );
      }
    }
  });

  it("keeps a way to buy every SKU in AUD", () => {
    for (const sku of CATALOGUE) {
      const full = offersPayInFull(sku) && bankDebitFor("aud", amountFor(sku, "aud", "full")).ok;
      const monthly =
        sku.instalments !== null && bankDebitFor("aud", amountFor(sku, "aud", "instalments")).ok;
      assert.ok(full || monthly, `${sku.slug} cannot be bought in AUD at all`);
    }
  });

  it("sells Elite monthly only, and that is what makes it sellable", () => {
    const elite = skuFor("elite-60s")!;
    assert.equal(offersPayInFull(elite), false);
    // The reason, pinned: paid at once it is over PayTo's ceiling anyway.
    assert.equal(bankDebitFor("aud", amountFor(elite, "aud", "full")).ok, false);
    assert.equal(bankDebitFor("aud", amountFor(elite, "aud", "instalments")).ok, true);
  });

  it("offers pay-in-full on everything else", () => {
    for (const sku of CATALOGUE.filter((s) => s.slug !== "elite-60s")) {
      assert.ok(offersPayInFull(sku), `${sku.slug} unexpectedly lost its pay-in-full option`);
    }
  });
});
