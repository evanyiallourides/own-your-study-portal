import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  MAX_DETAIL_EMAILS_PER_HOUR,
  includedLines,
  sendPaymentReceipt,
  sendTransferDetails,
  shouldSendReceipt,
  withinEmailLimit,
} from "@/lib/email/order-emails";
import { emailConfigured, sendEmail } from "@/lib/email/send";
import { SELLER, escapeHtml, receiptEmail, transferDetailsEmail } from "@/lib/email/templates";

/* What these protect: a receipt that fails must never fail an order; a receipt
   must go out exactly once; and a name typed into a public form must not turn
   into markup in somebody else's inbox. */

const ENV_KEYS = ["RESEND_API_KEY", "EMAIL_FROM", "EMAIL_REPLY_TO"] as const;

let savedEnv: Record<string, string | undefined>;
let realFetch: typeof fetch;
let calls: { url: string; init: RequestInit }[];

function stubFetch(respond: () => Response | Promise<Response>) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  }) as typeof fetch;
}

const ok = () => new Response(JSON.stringify({ id: "em_123" }), { status: 200 });

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  realFetch = globalThis.fetch;
  calls = [];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  globalThis.fetch = realFetch;
});

const sentBody = () => JSON.parse(String(calls[0]?.init.body));
const header = (name: string) => (calls[0]?.init.headers as Record<string, string>)[name];

describe("sendEmail", () => {
  const email = { to: "buyer@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi" };

  it("does nothing, and says so, when there is no API key", async () => {
    stubFetch(ok);
    const result = await sendEmail(email);
    assert.deepEqual(result, { ok: false, skipped: true, reason: "RESEND_API_KEY is not set." });
    assert.equal(calls.length, 0, "must not touch the network without a key");
    assert.equal(emailConfigured(), false);
  });

  it("posts to Resend with the key, the sender and an idempotency key", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    stubFetch(ok);

    const result = await sendEmail({ ...email, idempotencyKey: "receipt-abc" });

    assert.deepEqual(result, { ok: true, id: "em_123" });
    assert.equal(emailConfigured(), true);
    assert.equal(calls[0]?.url, "https://api.resend.com/emails");
    assert.equal(calls[0]?.init.method, "POST");
    assert.equal(header("Authorization"), "Bearer re_test_key");
    assert.equal(header("Idempotency-Key"), "receipt-abc");
    assert.deepEqual(sentBody(), {
      from: "Own Your Study <no-reply@ownyourstudy.com>",
      to: ["buyer@example.com"],
      reply_to: "hello@ownyourstudy.com",
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
    });
  });

  it("takes the sender and reply-to from the environment when set", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "Receipts <receipts@ownyourstudy.com>";
    process.env.EMAIL_REPLY_TO = "billing@ownyourstudy.com";
    stubFetch(ok);

    await sendEmail(email);

    assert.equal(sentBody().from, "Receipts <receipts@ownyourstudy.com>");
    assert.equal(sentBody().reply_to, "billing@ownyourstudy.com");
  });

  it("omits the idempotency header when none is given", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    stubFetch(ok);
    await sendEmail(email);
    assert.equal(header("Idempotency-Key"), undefined);
  });

  it("returns a failure instead of throwing when Resend refuses", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    stubFetch(() => new Response('{"message":"domain is not verified"}', { status: 403 }));

    const result = await sendEmail(email);

    assert.equal(result.ok, false);
    assert.ok(!result.ok && !result.skipped);
    assert.match(!result.ok ? result.reason : "", /403.*domain is not verified/);
  });

  it("returns a failure instead of throwing when the network does", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    stubFetch(() => {
      throw new Error("socket hang up");
    });

    const result = await sendEmail(email);

    assert.deepEqual(result, { ok: false, skipped: false, reason: "socket hang up" });
  });
});

describe("the transfer details email", () => {
  const input = {
    buyerName: "Sophia Thompson",
    skuName: "Standard Pack",
    amount: "€620",
    reference: "OYS-ERM597",
    accountHolder: "Dr Michalis Paediatrics Pty Ltd",
    accountLabel: "European bank transfer (SEPA)",
    details: ["IBAN: BE56 9059 8872 9188", "SWIFT/BIC: TRWIBEB1XXX"],
    orderUrl: "https://portal.ownyourstudy.com/checkout/instructions/abc",
  };

  it("carries everything a buyer needs to make the transfer", () => {
    const { subject, html, text } = transferDetailsEmail(input);
    assert.equal(subject, "Your bank transfer details — OYS-ERM597");
    for (const part of [html, text]) {
      for (const needed of ["€620", "OYS-ERM597", "Dr Michalis Paediatrics Pty Ltd", "BE56 9059 8872 9188", "TRWIBEB1XXX"]) {
        assert.ok(part.includes(needed), `missing ${needed}`);
      }
      assert.ok(part.includes("https://portal.ownyourstudy.com/checkout/instructions/abc"));
    }
  });

  it("labels each bank line rather than printing it raw", () => {
    const { html } = transferDetailsEmail(input);
    assert.ok(html.includes(">IBAN<"), "the label should be its own element");
    assert.ok(html.includes("BE56 9059 8872 9188"));
  });

  it("greets by first name, or plainly when there is none", () => {
    assert.ok(transferDetailsEmail(input).text.startsWith("Hi Sophia,"));
    assert.ok(transferDetailsEmail({ ...input, buyerName: null }).text.startsWith("Hello,"));
    assert.ok(transferDetailsEmail({ ...input, buyerName: "   " }).text.startsWith("Hello,"));
  });

  it("never lets a typed name or product become markup", () => {
    const { html } = transferDetailsEmail({
      ...input,
      buyerName: "<script>alert(1)</script>",
      skuName: '<img src=x onerror="steal()">',
      orderUrl: 'https://x.test/"><script>1</script>',
    });
    assert.ok(!html.includes("<script>"), "a script tag survived");
    assert.ok(!html.includes("<img src=x"), "an injected element survived");
    assert.ok(!/href="[^"]*"><script/.test(html), "the link attribute was broken out of");
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;") || html.includes("Hi &lt;script&gt;"));
  });
});

describe("the receipt email", () => {
  const input = {
    buyerName: "Sophia Thompson",
    skuName: "Standard Pack",
    quantity: 1,
    amount: "€620",
    reference: "OYS-ERM597",
    paidOn: "19 October 2026",
    included: ["Question bank access for 365 days"],
    portalUrl: "https://portal.ownyourstudy.com/login",
  };

  it("names the seller and its ABN, as published in the terms", () => {
    assert.equal(SELLER.legalName, "Dr Michalis Paediatrics Pty Ltd");
    assert.equal(SELLER.abn, "64 688 272 988");
    const { subject, html, text } = receiptEmail(input);
    assert.equal(subject, "Payment received — OYS-ERM597");
    for (const part of [html, text]) {
      assert.ok(part.includes("Dr Michalis Paediatrics Pty Ltd"));
      assert.ok(part.includes("64 688 272 988"));
      assert.ok(part.includes("19 October 2026"));
      assert.ok(part.includes("Question bank access for 365 days"));
    }
  });

  it("shows the quantity only when it is more than one", () => {
    assert.ok(!receiptEmail(input).text.includes("×"));
    assert.ok(receiptEmail({ ...input, quantity: 3 }).text.includes("Standard Pack × 3"));
  });

  it("leaves out the included list when nothing was granted", () => {
    const { html, text } = receiptEmail({ ...input, included: [] });
    assert.ok(!html.includes("Included with this purchase"));
    assert.ok(!text.includes("Included with this purchase"));
  });

  it("escapes what a stranger typed into the form", () => {
    const { html } = receiptEmail({ ...input, buyerName: "<b onmouseover=x>Eve</b>", skuName: "<i>Pack</i>" });
    assert.ok(!html.includes("<b onmouseover"));
    assert.ok(!html.includes("<i>Pack</i>"));
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters that matter in text and attributes", () => {
    assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
});

describe("when a receipt goes out", () => {
  it("sends on the first payment, from any unpaid status", () => {
    for (const before of ["pending", "authorised"]) {
      assert.equal(shouldSendReceipt(before, true), true, before);
    }
  });

  it("does not send a second one for a replay of the same payment", () => {
    for (const before of ["paid", "instalments_active", "completed"]) {
      assert.equal(shouldSendReceipt(before, true), false, before);
    }
  });

  it("does not send when nothing was settled", () => {
    assert.equal(shouldSendReceipt("pending", false), false);
  });
});

describe("the hourly limit on details emails", () => {
  it("allows a few tries, then stops", () => {
    assert.equal(MAX_DETAIL_EMAILS_PER_HOUR, 3);
    assert.equal(withinEmailLimit(1), true);
    assert.equal(withinEmailLimit(3), true);
    assert.equal(withinEmailLimit(4), false);
  });
});

describe("what a purchase included", () => {
  it("describes each grant in words, and nothing else", () => {
    assert.deepEqual(includedLines({ questionBankDays: null, iaMarkings: null }), []);
    assert.deepEqual(includedLines({ questionBankDays: 365, iaMarkings: null }), ["Question bank access for 365 days"]);
    assert.deepEqual(includedLines({ questionBankDays: null, iaMarkings: 1 }), ["1 IA marking review"]);
    assert.deepEqual(includedLines({ questionBankDays: null, iaMarkings: 3 }), ["3 IA marking reviews"]);
  });
});

describe("sending the details for an order", () => {
  const base = {
    orderId: "ord1",
    buyerEmail: "buyer@example.com",
    buyerName: "Sophia",
    skuName: "Standard Pack",
    amountTotalMinor: 62000,
    currency: "eur",
    reference: "OYS-ERM597",
    account: { accountHolder: "Dr Michalis Paediatrics Pty Ltd", label: "SEPA", details: ["IBAN: BE56 9059 8872 9188"] },
    appUrl: "https://portal.ownyourstudy.com",
  };

  /* Just enough of the query builder: orders -> select -> ilike -> gte. */
  const dbWith = (result: { count: number | null; error: unknown }) =>
    ({ from: () => ({ select: () => ({ ilike: () => ({ gte: async () => result }) }) }) }) as never;

  it("sends once, with the order's own idempotency key and a link back to its page", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    stubFetch(ok);

    await sendTransferDetails({ ...base, db: dbWith({ count: 1, error: null }) });

    assert.equal(calls.length, 1);
    assert.equal(header("Idempotency-Key"), "details-ord1");
    assert.deepEqual(sentBody().to, ["buyer@example.com"]);
    assert.ok(sentBody().text.includes("https://portal.ownyourstudy.com/checkout/instructions/ord1"));
    assert.ok(sentBody().text.includes("OYS-ERM597"));
  });

  it("stays quiet once an address is over its limit", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    stubFetch(ok);
    await sendTransferDetails({ ...base, db: dbWith({ count: 4, error: null }) });
    assert.equal(calls.length, 0);
  });

  it("stays quiet when it cannot tell how many there have been", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    stubFetch(ok);
    await sendTransferDetails({ ...base, db: dbWith({ count: null, error: { message: "boom" } }) });
    assert.equal(calls.length, 0);
  });

  it("never throws, even when everything goes wrong", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    stubFetch(() => {
      throw new Error("network down");
    });
    await assert.doesNotReject(sendTransferDetails({ ...base, db: dbWith({ count: 1, error: null }) }));
    await assert.doesNotReject(
      sendTransferDetails({
        ...base,
        db: { from: () => { throw new Error("db down"); } } as never,
      }),
    );
  });
});

describe("sending the receipt for an order", () => {
  const order = {
    orderId: "ord1",
    buyerEmail: "buyer@example.com",
    buyerName: "Sophia",
    skuName: "Question Bank",
    quantity: 1,
    amountMinor: 12000,
    currency: "eur",
    reference: "OYS-ERM597",
    questionBankDays: 365,
    iaMarkings: null,
    portalUrl: "https://portal.ownyourstudy.com/login",
  };

  it("sends one receipt carrying the amount, reference and what was included", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    stubFetch(ok);

    await sendPaymentReceipt(order);

    assert.equal(calls.length, 1);
    assert.equal(header("Idempotency-Key"), "receipt-ord1");
    assert.equal(sentBody().subject, "Payment received — OYS-ERM597");
    assert.ok(sentBody().text.includes("€120"));
    assert.ok(sentBody().text.includes("Question bank access for 365 days"));
  });

  it("never throws, with or without a key", async () => {
    stubFetch(() => {
      throw new Error("network down");
    });
    await assert.doesNotReject(sendPaymentReceipt(order));
    process.env.RESEND_API_KEY = "re_test_key";
    await assert.doesNotReject(sendPaymentReceipt(order));
  });
});
