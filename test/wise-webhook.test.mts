import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";

import { verifyWiseWebhookSignature } from "@/lib/payments/wise";
import { parseIncomingTransferEvent } from "@/lib/payments/wise-webhook-event";

/* ==========================================================================
   The Wise webhook's own logic, apart from the route
   --------------------------------------------------------------------------
   `planFor` — what a settled payment actually does to an order — is already
   proven provider-neutrally by stripe-webhook.test.mts; nothing here repeats
   it. What is new to this provider is the signature check (an RSA scheme,
   unlike Stripe's shared secret) and reading Wise's own event envelope, so
   those are what get exercised here.
   ========================================================================== */

describe("verifying a Wise webhook signature", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.WISE_WEBHOOK_PUBLIC_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.WISE_WEBHOOK_PUBLIC_KEY;
    else process.env.WISE_WEBHOOK_PUBLIC_KEY = originalKey;
  });

  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  function sign(body: string): string {
    return createSign("RSA-SHA256").update(body).sign(privateKeyPem, "base64");
  }

  it("accepts a signature that actually matches the body", () => {
    process.env.WISE_WEBHOOK_PUBLIC_KEY = publicKeyPem;
    const body = JSON.stringify({ event_type: "incoming-transfer#credited" });
    assert.equal(verifyWiseWebhookSignature(body, sign(body)), true);
  });

  it("refuses a signature for a body that was tampered with after signing", () => {
    process.env.WISE_WEBHOOK_PUBLIC_KEY = publicKeyPem;
    const original = JSON.stringify({ event_type: "incoming-transfer#credited" });
    const signature = sign(original);
    const tampered = JSON.stringify({ event_type: "incoming-transfer#credited", extra: true });
    assert.equal(verifyWiseWebhookSignature(tampered, signature), false);
  });

  it("refuses a signature made with the wrong key", () => {
    process.env.WISE_WEBHOOK_PUBLIC_KEY = publicKeyPem;
    const { privateKey: otherKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const body = JSON.stringify({ event_type: "incoming-transfer#credited" });
    const wrongSignature = createSign("RSA-SHA256")
      .update(body)
      .sign(otherKey.export({ type: "pkcs8", format: "pem" }).toString(), "base64");
    assert.equal(verifyWiseWebhookSignature(body, wrongSignature), false);
  });

  it("refuses when no public key is configured, rather than accepting on trust", () => {
    delete process.env.WISE_WEBHOOK_PUBLIC_KEY;
    const body = JSON.stringify({ event_type: "incoming-transfer#credited" });
    assert.equal(verifyWiseWebhookSignature(body, sign(body)), false);
  });

  it("refuses a missing signature header outright", () => {
    process.env.WISE_WEBHOOK_PUBLIC_KEY = publicKeyPem;
    assert.equal(verifyWiseWebhookSignature("{}", null), false);
  });

  it("refuses garbage instead of throwing", () => {
    process.env.WISE_WEBHOOK_PUBLIC_KEY = publicKeyPem;
    assert.equal(verifyWiseWebhookSignature("{}", "not base64 at all !!"), false);
  });
});

describe("reading a Wise webhook envelope", () => {
  it("extracts the transfer id from a credited event", () => {
    const event = parseIncomingTransferEvent({
      event_type: "incoming-transfer#credited",
      subscription_id: "sub_1",
      data: { resource: { id: "transfer_1", type: "incoming-transfer" } },
    });
    assert.ok(event);
    assert.equal(event.eventType, "incoming-transfer#credited");
    assert.equal(event.transferId, "transfer_1");
    assert.equal(event.eventId, "sub_1:transfer_1");
  });

  it("still produces a stable event id when there is no subscription id", () => {
    const event = parseIncomingTransferEvent({
      event_type: "incoming-transfer#credited",
      data: { resource: { id: "transfer_2" } },
    });
    assert.ok(event);
    assert.equal(event.eventId, "transfer_2");
  });

  it("returns null for a body with no event type at all", () => {
    assert.equal(parseIncomingTransferEvent({ data: {} }), null);
    assert.equal(parseIncomingTransferEvent(null), null);
    assert.equal(parseIncomingTransferEvent("not an object"), null);
  });

  it("still parses an event type it does not otherwise recognise", () => {
    // The route decides what to ignore; this function's only job is reading
    // the envelope honestly, so a type this integration does not subscribe to
    // still comes back rather than being silently swallowed here.
    const event = parseIncomingTransferEvent({
      event_type: "balances#credit",
      data: { resource: { id: "balance_1" } },
    });
    assert.ok(event);
    assert.equal(event.eventType, "balances#credit");
  });
});
