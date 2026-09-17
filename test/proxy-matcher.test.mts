import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/* The matcher decides what the auth proxy even looks at. Getting it wrong in
   the permissive direction publishes whatever it stops matching, and nothing
   else in the codebase would notice — so the regex is read out of the source
   and exercised here rather than trusted by eye. */

const source = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");

const pattern = (() => {
  const found = /"(\/\(\(\?!.*?\)\.\*\))"/.exec(source)?.[1];
  assert.ok(found, "could not find the matcher pattern in src/proxy.ts");
  // The source is a TypeScript string literal, so its backslashes are doubled.
  return new RegExp(`^${found.replace(/\\\\/g, "\\")}$`);
})();

const matched = (pathname: string) => pattern.test(pathname);

describe("the proxy matcher", () => {
  it("guards the paid question bank content", () => {
    /* The whole product. `/api/question-banks/` is plural and under /api; the
       exclusion is for `/question-bank/`, singular, which is only the viewer.
       One character between a gate and an open door. */
    for (const path of [
      "/api/question-banks/index.json",
      "/api/question-banks/bio-hl-p1.json",
      "/api/papers/may-2026-bio-hl-p1.json",
    ]) {
      assert.ok(matched(path), `${path} is NOT going through the proxy — paid content would be public`);
    }
  });

  it("guards every signed-in page", () => {
    for (const path of ["/student", "/student/question-banks", "/tutor", "/admin/orders", "/parent"]) {
      assert.ok(matched(path), `${path} is not behind the proxy`);
    }
  });

  it("lets the viewer scripts through without an auth round trip", () => {
    for (const path of ["/question-bank/qbank.js", "/question-bank/papers.js"]) {
      assert.ok(!matched(path), `${path} still goes through the proxy`);
    }
  });

  it("lets build output and images through", () => {
    for (const path of [
      "/_next/static/chunks/main.js",
      "/_next/image",
      "/favicon.ico",
      "/brand/mark.png",
      "/anything.svg",
    ]) {
      assert.ok(!matched(path), `${path} still goes through the proxy`);
    }
  });

  it("keeps the webhook matched, because it is excluded in code instead", () => {
    // It has to reach the proxy and be short-circuited by isPublic, which is
    // what preserves the raw body Stripe's signature is computed over.
    assert.ok(matched("/api/webhooks/stripe"));
  });
});
