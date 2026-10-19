import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EMBED_ORIGINS,
  FRAMEABLE_SOURCES,
  UNFRAMEABLE_SOURCE,
  checkoutErrorMessage,
  checkoutErrorPath,
  frameAncestors,
  instructionsPath,
  isEmbed,
} from "@/lib/payments/checkout-embed";

/* Who may frame what is a security decision, and the pattern that makes it is a
   regex — the sort of thing that is wrong by one character and looks fine. So
   it is run here, the same way the proxy matcher's is, rather than eyeballed.

   `source` is path-to-regexp, whose unnamed group is the same shape as a JS
   one; for this pattern, anchoring it is the whole translation. */
const unframeable = new RegExp(`^${UNFRAMEABLE_SOURCE}$`);
const unframed = (pathname: string) => unframeable.test(pathname);

describe("what stays unframeable", () => {
  it("covers the login page and everything behind it", () => {
    for (const path of ["/", "/login", "/admin/orders", "/student/question-banks", "/parent/billing"]) {
      assert.equal(unframed(path), true, `${path} must keep X-Frame-Options: DENY`);
    }
  });

  it("covers the other API routes, webhooks included", () => {
    for (const path of ["/api/webhooks/wise", "/api/webhooks/stripe", "/api/question-banks/index.json"]) {
      assert.equal(unframed(path), true, `${path} must keep X-Frame-Options: DENY`);
    }
  });

  it("does not cover the checkout pages or the route they post to", () => {
    for (const path of [
      "/checkout/standard-10hr",
      "/checkout/instructions/0b9d9e5e-0000-4000-8000-000000000000",
      "/checkout/success",
      "/api/checkout",
    ]) {
      assert.equal(unframed(path), false, `${path} must be frameable`);
    }
  });

  it("is not fooled by a path that merely starts like checkout", () => {
    for (const path of ["/checkouts", "/checkout-admin", "/api/checkout-export", "/api/checkouts/1"]) {
      assert.equal(unframed(path), true, `${path} is not checkout and must stay unframeable`);
    }
  });
});

describe("the frame-ancestors policy", () => {
  it("lets the marketing site frame checkout, and nobody else", () => {
    const policy = frameAncestors(false);
    assert.equal(policy, "frame-ancestors https://ownyourstudy.com https://www.ownyourstudy.com");
    assert.ok(!policy.includes("*"), "production must not allow a wildcard");
    assert.ok(!policy.includes("localhost"));
  });

  it("opens up localhost only for development", () => {
    const policy = frameAncestors(true);
    for (const origin of EMBED_ORIGINS) assert.ok(policy.includes(origin));
    assert.ok(policy.includes("http://localhost:*"));
  });

  it("names exactly the two paths that are frameable", () => {
    assert.deepEqual([...FRAMEABLE_SOURCES], ["/checkout/:path*", "/api/checkout"]);
  });
});

describe("the embed flag", () => {
  it("is on only for exactly 1", () => {
    assert.equal(isEmbed("1"), true);
    for (const value of ["0", "true", "yes", "", undefined, null, ["1"]]) {
      assert.equal(isEmbed(value as never), false);
    }
  });

  it("rides along to the instructions page only when set", () => {
    assert.equal(instructionsPath("abc", true), "/checkout/instructions/abc?embed=1");
    assert.equal(instructionsPath("abc", false), "/checkout/instructions/abc");
  });
});

describe("a refusal shown in the sheet", () => {
  it("sends the buyer back to the same form with a reason code", () => {
    const path = checkoutErrorPath({
      slug: "standard-10hr",
      site: "own-your-ib",
      currency: "eur",
      code: "email",
    });
    assert.equal(path, "/checkout/standard-10hr?site=own-your-ib&ccy=eur&embed=1&error=email");
  });

  it("drops what it was not given", () => {
    const path = checkoutErrorPath({ slug: "question-bank", site: null, currency: null, code: "failed" });
    assert.equal(path, "/checkout/question-bank?embed=1&error=failed");
  });

  it("encodes a hostile value rather than passing it through", () => {
    const path = checkoutErrorPath({
      slug: "x/../login",
      site: "a&embed=0",
      currency: null,
      code: "failed",
    });
    assert.ok(path.startsWith("/checkout/x%2F..%2Flogin?"), path);
    assert.ok(path.includes("site=a%26embed%3D0"), path);
  });

  it("only ever shows wording of ours, never what the URL says", () => {
    assert.equal(checkoutErrorMessage("email"), "Please enter a valid email address.");
    assert.equal(checkoutErrorMessage("Send your money to account 123"), null);
    assert.equal(checkoutErrorMessage(undefined), null);
    assert.equal(checkoutErrorMessage(["email"]), null);
  });
});
