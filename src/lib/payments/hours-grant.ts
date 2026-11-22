import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Sku } from "@/lib/catalogue";
import { writeOrderColumns } from "@/lib/payments/order-writes";

/**
 * Record on a new order how many tutoring hours it buys.
 *
 * Written after the insert rather than inside it, through writeOrderColumns,
 * so a database that has not run the hours migration yet still takes the
 * order: the column is dropped and the checkout carries on. An insert naming
 * an unknown column would refuse the whole row, and a checkout that 500s
 * because of a migration nobody has pasted in is money not taken.
 *
 * Per unit, like the IA credits. claim_orders_for_profile() multiplies by
 * quantity when the order settles.
 */
export async function recordHoursGrant(db: SupabaseClient, orderId: string, sku: Sku): Promise<void> {
  if (!sku.hours) return;
  const written = await writeOrderColumns(db, orderId, { grants_tutoring_hours: sku.hours });
  if (written.skipped.length > 0) {
    console.warn(
      `[checkout] order ${orderId}: database has no grants_tutoring_hours — ` +
        "the hours will not be credited until the migration runs.",
    );
  }
  if (written.error) {
    console.error(`[checkout] order ${orderId}: could not record its hours: ${written.error}`);
  }
}
