import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { btcPayConfig, fiatMinor, invoiceMatches, isSettledInvoice, safeCheckoutLink,
  verifyBtcPaySignature, btcPayFetch, hasMainnetBitcoinDestination, type BtcPayInvoice } from "@/lib/payments/btcpay";

const settings = { BTCPAY_URL: "https://pay.example.com", BTCPAY_STORE_ID: "store",
  BTCPAY_API_KEY: "test-key", BTCPAY_WEBHOOK_SECRET: "test-secret",
  BTCPAY_LIVE_ENABLED: "true", BTCPAY_NETWORK: "mainnet" };
const order = { id: "order-1", provider_checkout_id: "invoice-1", currency: "eur", amount_total_minor: 500000 };
const invoice: BtcPayInvoice = { id: "invoice-1", storeId: "store", amount: "5000.00", currency: "EUR",
  status: "Settled", additionalStatus: "None", checkoutLink: "https://pay.example.com/i/invoice-1", metadata: { orderId: "order-1" } };

describe("BTCPay live safeguards", () => {
  it("requires explicit mainnet activation and all secrets", () => {
    assert.ok(btcPayConfig(settings));
    for (const key of Object.keys(settings)) assert.equal(btcPayConfig({ ...settings, [key]: "" }), null, key);
    assert.equal(btcPayConfig({ ...settings, BTCPAY_NETWORK: "testnet" }), null);
  });
  it("rejects demonstration servers, insecure URLs and embedded credentials", () => {
    for (const url of ["https://testnet.demo.btcpayserver.org", "https://mainnet.demo.btcpayserver.org",
      "http://pay.example.com", "https://user:pass@pay.example.com", "https://pay.example.com/path",
      "https://pay.example.com/?token=oops", "https://localhost"]) {
      assert.equal(btcPayConfig({ ...settings, BTCPAY_URL: url }), null, url);
    }
  });
  it("authenticates the exact raw body using the configured secret", () => {
    const body = JSON.stringify({ invoiceId: "invoice-1", metadata: { secret: "attacker-chosen" } });
    const sign = (secret: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    assert.equal(verifyBtcPaySignature(body, sign("test-secret"), "test-secret"), true);
    for (const signature of [null, "", "sha256=abc", sign("attacker-chosen")]) {
      assert.equal(verifyBtcPaySignature(body, signature, "test-secret"), false);
    }
    assert.equal(verifyBtcPaySignature(body + " ", sign("test-secret"), "test-secret"), false);
  });
  it("compares amounts exactly and does not round underpayments", () => {
    assert.equal(fiatMinor("5000.00000000"), 500000);
    assert.equal(fiatMinor("5000.001"), null);
    assert.equal(fiatMinor("4999.999"), null);
    for (const bad of [5000, null, "NaN", "-1", "1e4", "9007199254740991"]) assert.equal(fiatMinor(bad), null);
  });
  it("binds invoice, store, order, currency and price", () => {
    assert.equal(invoiceMatches(invoice, order, "store"), true);
    for (const patch of [{ id: "other" }, { storeId: "other" }, { amount: "4999.99" },
      { currency: "USD" }, { metadata: { orderId: "other" } }, { metadata: undefined }]) {
      assert.equal(invoiceMatches({ ...invoice, ...patch }, order, "store"), false);
    }
  });
  it("does not fulfil unconfirmed, partial, expired, marked or late invoices", () => {
    for (const status of ["New", "Processing", "Expired", "Invalid"]) {
      assert.equal(isSettledInvoice({ ...invoice, status }), false);
    }
    for (const additionalStatus of ["PaidPartial", "PaidLate", "Marked", "Invalid", "", "unknown"]) {
      assert.equal(isSettledInvoice({ ...invoice, additionalStatus }), false);
    }
    assert.equal(isSettledInvoice(invoice), true);
    assert.equal(isSettledInvoice({ ...invoice, additionalStatus: "PaidOver" }), true);
  });
  it("refuses checkout redirects away from the configured host", () => {
    const config = btcPayConfig(settings)!;
    assert.equal(safeCheckoutLink(invoice.checkoutLink, config), invoice.checkoutLink);
    for (const link of ["https://evil.example/i/1", "javascript:alert(1)", "http://pay.example.com/i/1", "https://u:p@pay.example.com/i/1"]) {
      assert.equal(safeCheckoutLink(link, config), null);
    }
  });
  it("scopes authenticated API calls and refuses HTTP redirects", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (input, init) => {
        assert.equal(input, "https://pay.example.com/api/v1/stores/store/invoices/one");
        assert.equal(init?.redirect, "error");
        assert.equal(init?.cache, "no-store");
        assert.equal(new Headers(init?.headers).get("Authorization"), "token test-key");
        return Response.json(invoice);
      };
      assert.deepEqual(await btcPayFetch(btcPayConfig(settings)!, "/invoices/one"), invoice);
    } finally { globalThis.fetch = originalFetch; }
  });
});

it("checks the actual Bitcoin destination rather than trusting a mainnet label", () => {
  assert.equal(hasMainnetBitcoinDestination([{paymentMethodId: "BTC-CHAIN", destination: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT"}]), true);
  for (const destination of ["tb1qqyhsj6rntuuc5sru04dusf2zeeae4tqsh44eg5", "bcrt1qtest", "", "not-an-address"]) {
    assert.equal(hasMainnetBitcoinDestination([{paymentMethodId: "BTC-CHAIN", destination}]), false);
  }
  assert.equal(hasMainnetBitcoinDestination([{paymentMethodId: "BTC-LN", destination: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT"}]), false);
});
