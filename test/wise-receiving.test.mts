import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { explainWiseRefusal, wiseAccountFor } from "@/lib/payments/wise-receiving";

const ENV_KEYS = [
  "WISE_ACCOUNT_HOLDER",
  "WISE_USD_ACCOUNT_DETAILS",
  "WISE_EUR_ACCOUNT_DETAILS",
  "WISE_GBP_ACCOUNT_DETAILS",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("Wise receiving accounts", () => {
  it("has no account for a currency nobody has set up yet", () => {
    assert.equal(wiseAccountFor("usd"), null);
  });

  it("never offers AUD — that stays on Stripe", () => {
    process.env.WISE_ACCOUNT_HOLDER = "Own Your Study Pty Ltd";
    process.env.WISE_USD_ACCOUNT_DETAILS = "Account number: 123\nRouting number: 456";
    assert.equal(wiseAccountFor("aud"), null);
  });

  it("returns a usable account once the holder and its details are both set", () => {
    process.env.WISE_ACCOUNT_HOLDER = "Own Your Study Pty Ltd";
    process.env.WISE_GBP_ACCOUNT_DETAILS = "Account number: 111\nSort code: 22-33-44";
    const account = wiseAccountFor("gbp");
    assert.ok(account);
    assert.equal(account.currency, "gbp");
    assert.equal(account.accountHolder, "Own Your Study Pty Ltd");
    assert.deepEqual(account.details, ["Account number: 111", "Sort code: 22-33-44"]);
  });

  it("stays unset without an account holder even if the details are there", () => {
    process.env.WISE_EUR_ACCOUNT_DETAILS = "IBAN: DE00 0000 0000 0000 00";
    assert.equal(wiseAccountFor("eur"), null);
  });

  it("explains the refusal in words aimed at the buyer", () => {
    for (const ccy of ["usd", "eur", "gbp"] as const) {
      const text = explainWiseRefusal(ccy);
      assert.ok(text.length > 30, `${ccy} produced a stub`);
      assert.ok(!/undefined|null|NaN/.test(text), `${ccy} leaked a placeholder: ${text}`);
    }
  });
});
