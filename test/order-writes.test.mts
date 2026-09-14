import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { columnFromSchemaError, writeOrderColumns } from "@/lib/payments/order-writes";

/* ==========================================================================
   Writing to an order against a schema that may be behind
   --------------------------------------------------------------------------
   Code and schema deploy separately. PostgREST rejects the whole statement
   when one column is unknown, so without this a migration nobody has run yet
   turns into a payment recorded nowhere — status, amount and customer all lost
   over a single field.
   ========================================================================== */

/** A database that knows about `known` and rejects everything else the way PostgREST does. */
function fakeDb(known: string[], failWith?: string) {
  const attempts: string[][] = [];
  const db = {
    from() {
      return {
        update(columns: Record<string, unknown>) {
          attempts.push(Object.keys(columns));
          return {
            eq() {
              if (failWith) return Promise.resolve({ error: { message: failWith } });
              const unknown = Object.keys(columns).find((c) => !known.includes(c));
              return Promise.resolve({
                error: unknown
                  ? {
                      message: `Could not find the '${unknown}' column of 'orders' in the schema cache`,
                    }
                  : null,
              });
            },
          };
        },
      };
    },
  };
  return { db, attempts };
}

describe("reading a missing-column error", () => {
  it("finds the column PostgREST names", () => {
    assert.equal(
      columnFromSchemaError("Could not find the 'student_email' column of 'orders' in the schema cache"),
      "student_email",
    );
  });

  it("finds it in Postgres's own wording too", () => {
    assert.equal(
      columnFromSchemaError('column "student_email" of relation "orders" does not exist'),
      "student_email",
    );
  });

  it("returns null for anything that is not about a column", () => {
    for (const other of [
      null,
      undefined,
      "",
      'duplicate key value violates unique constraint "orders_pkey"',
      "could not connect to server",
    ]) {
      assert.equal(columnFromSchemaError(other as string), null, String(other));
    }
  });
});

describe("writing what the database will take", () => {
  it("writes everything when the schema is up to date", async () => {
    const { db, attempts } = fakeDb(["status", "amount_paid_minor", "student_email"]);
    const r = await writeOrderColumns(db as never, "ord_1", {
      status: "paid",
      amount_paid_minor: 12000,
      student_email: "a@b.com",
    });
    assert.deepEqual(r.skipped, []);
    assert.equal(r.error, null);
    assert.equal(attempts.length, 1, "no retry needed");
  });

  it("drops a column the database has not been told about, and writes the rest", async () => {
    // This is the whole point: a payment must still be recorded when a
    // migration is outstanding.
    const { db } = fakeDb(["status", "amount_paid_minor"]);
    const r = await writeOrderColumns(db as never, "ord_1", {
      status: "paid",
      amount_paid_minor: 12000,
      student_email: "a@b.com",
    });
    assert.deepEqual(r.skipped, ["student_email"]);
    assert.deepEqual(r.applied.sort(), ["amount_paid_minor", "status"]);
    assert.equal(r.error, null, "a schema that is behind is not a failure");
  });

  it("drops several, one attempt at a time", async () => {
    const { db, attempts } = fakeDb(["status"]);
    const r = await writeOrderColumns(db as never, "ord_1", {
      status: "paid",
      student_email: "a@b.com",
      provider_mandate_id: "MD1",
    });
    assert.equal(r.skipped.length, 2);
    assert.deepEqual(r.applied, ["status"]);
    assert.equal(attempts.length, 3, "one attempt per unknown column, then success");
  });

  it("reports anything that is not a missing column, rather than retrying it", async () => {
    // A constraint violation retried forever would be a webhook that never
    // finishes. It has to come back as an error the caller records.
    const { db, attempts } = fakeDb([], "duplicate key value violates unique constraint");
    const r = await writeOrderColumns(db as never, "ord_1", { status: "paid" });
    assert.match(r.error ?? "", /duplicate key/);
    assert.equal(attempts.length, 1, "must not retry a real error");
  });

  it("cannot loop, because every attempt is strictly smaller", async () => {
    const { db, attempts } = fakeDb([]);
    const r = await writeOrderColumns(db as never, "ord_1", { a: 1, b: 2, c: 3 });
    assert.equal(r.skipped.length, 3);
    assert.equal(r.applied.length, 0);
    assert.equal(r.error, null);
    assert.ok(attempts.length <= 3, `gave up after ${attempts.length} attempts`);
  });
});
