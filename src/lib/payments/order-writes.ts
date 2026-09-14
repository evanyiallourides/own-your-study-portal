import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/* ==========================================================================
   Writing to an order without knowing which migrations have run
   --------------------------------------------------------------------------
   Code and schema deploy separately, and not always in that order. A webhook
   that writes a column the database has not been told about yet fails the
   WHOLE update — PostgREST rejects the statement, not the unknown field — so a
   payment's status, amount and customer are all lost because of one column
   added in a migration nobody has pasted in yet.

   That turns an ordering mistake into money taken and not recorded, which is
   the one outcome this integration is built to avoid. So an unknown column is
   dropped and the rest is written, loudly enough to be visible and quietly
   enough not to fail the delivery.

   It only ever drops columns the database says it does not have. Anything else
   — a constraint violation, a bad value, a dropped connection — is returned as
   an error for the caller to record, which is the other half of this: the
   update's error was previously not looked at at all.
   ========================================================================== */

/** PostgREST's "no such column" reply names the column; this pulls it out. */
export function columnFromSchemaError(message: string | null | undefined): string | null {
  if (!message) return null;
  const named = /Could not find the '([^']+)' column/i.exec(message);
  if (named?.[1]) return named[1];
  // Older wording, and the one Postgres itself uses.
  const fallback = /column "([^"]+)" of relation/i.exec(message);
  return fallback?.[1] ?? null;
}

export interface OrderWriteResult {
  /** Columns the database accepted. */
  applied: string[];
  /** Columns it does not have yet, dropped so the rest could be written. */
  skipped: string[];
  /** Anything that was not a missing column. Null when the write succeeded. */
  error: string | null;
}

/**
 * Apply what the database will take.
 *
 * Retries only on a missing column, and only ever narrows what it is trying to
 * write, so it cannot loop: each attempt has strictly fewer columns than the
 * last and stops when there are none left.
 */
export async function writeOrderColumns(
  db: SupabaseClient,
  orderId: string,
  columns: Record<string, unknown>,
): Promise<OrderWriteResult> {
  let remaining = { ...columns };
  const skipped: string[] = [];

  while (Object.keys(remaining).length > 0) {
    const { error } = await db.from("orders").update(remaining).eq("id", orderId);
    if (!error) return { applied: Object.keys(remaining), skipped, error: null };

    const missing = columnFromSchemaError(error.message);
    if (!missing || !(missing in remaining)) {
      return { applied: [], skipped, error: error.message };
    }

    delete remaining[missing];
    skipped.push(missing);
  }

  // Everything we had was a column this database does not know about.
  return { applied: [], skipped, error: null };
}
