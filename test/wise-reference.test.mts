import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findOrderByReference, generatePaymentReference } from "@/lib/payments/wise-reference";

/** A fake `orders` table matching whatever `.eq()` filters were applied so far. */
function fakeOrdersTable(matches: (filters: Record<string, string>) => boolean) {
  return {
    from(table: string) {
      assert.equal(table, "orders");
      const filters: Record<string, string> = {};
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: string) {
          filters[column] = value;
          return builder;
        },
        async maybeSingle() {
          return { data: matches(filters) ? { id: "order-1" } : null };
        },
      };
      return builder;
    },
  };
}

describe("generatePaymentReference", () => {
  it("produces a short, human-typeable reference with a recognisable prefix", async () => {
    const ref = await generatePaymentReference(fakeOrdersTable(() => false) as never);
    assert.match(ref, /^OYS-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  });

  it("never returns a reference that collides with an existing order", async () => {
    // The first three candidates are forced to "already exist"; the fourth
    // must be accepted instead of giving up.
    let attempts = 0;
    const db = fakeOrdersTable(() => {
      attempts += 1;
      return attempts <= 3;
    });
    const ref = await generatePaymentReference(db as never);
    assert.match(ref, /^OYS-/);
    assert.ok(attempts >= 4, "should have retried past the forced collisions");
  });

  it("gives up rather than looping forever against a database that always collides", async () => {
    await assert.rejects(
      () => generatePaymentReference(fakeOrdersTable(() => true) as never),
      /Could not generate a unique payment reference/,
    );
  });
});

describe("findOrderByReference", () => {
  it("matches regardless of case or surrounding whitespace", async () => {
    const db = fakeOrdersTable(
      (f) => f.provider === "wise" && f.payment_reference === "OYS-AB12CD",
    );
    const found = await findOrderByReference(db as never, "  oys-ab12cd  ");
    assert.ok(found);
    assert.equal(found.id, "order-1");
  });

  it("returns null for a reference nobody used", async () => {
    const db = fakeOrdersTable(
      (f) => f.provider === "wise" && f.payment_reference === "OYS-AB12CD",
    );
    assert.equal(await findOrderByReference(db as never, "OYS-ZZ9999"), null);
  });

  it("only ever looks among Wise orders", async () => {
    const db = fakeOrdersTable((f) => f.payment_reference === "OYS-AB12CD" && f.provider !== "wise");
    assert.equal(await findOrderByReference(db as never, "OYS-AB12CD"), null);
  });
});
