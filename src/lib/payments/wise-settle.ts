import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { claimOrderForBuyer, notifyAdmins, revokeOrderEntitlement } from "@/lib/payments/entitlements";
import { enrolPaidBuyer, enrolPaidParent, resolveParent, resolveStudent } from "@/lib/payments/enrolment";
import { planFor, type OrderState, type PaymentSignal } from "@/lib/payments/events";
import { writeOrderColumns } from "@/lib/payments/order-writes";

/* ==========================================================================
   Settling a Wise transfer against an order
   --------------------------------------------------------------------------
   The back half of the Stripe webhook, reused rather than reimplemented:
   planFor, writeOrderColumns, resolveStudent/resolveParent and the
   claim/enrol/notify calls are all provider-neutral already, and none of them
   import Stripe or branch on its vocabulary. This module's job is narrower
   than that webhook's, in two ways that both come from decisions already
   made elsewhere: a Wise order's buyer/student identity was captured directly
   in our own checkout form (there is no later hosted step to backfill it
   from, the way Stripe's session provides), and instalments are off, so the
   only signal a Wise order ever needs is `settled` — a credited balance has
   already moved, with no separate authorisation phase the way a direct debit
   has.

   Called from two places: the webhook, when a reference matches
   automatically, and the admin "attach this transfer" action, when a person
   matches it by hand. Both must produce the same result, which is the whole
   reason this exists as one function instead of two copies.
   ========================================================================== */

export interface WiseTransfer {
  transferId: string;
  amountMinor: number;
  currency: string;
}

export type SettleResult = { ok: true } | { ok: false; reason: string };

export async function settleWiseTransfer(
  db: SupabaseClient,
  orderId: string,
  transfer: WiseTransfer,
): Promise<SettleResult> {
  const { data: row } = await db
    .from("orders")
    .select(
      "id, plan, status, amount_total_minor, amount_paid_minor, grants_question_bank_days, grants_ia_markings, buyer_email, buyer_name, buyer_is_guardian, student_email, sku_name",
    )
    .eq("id", orderId)
    .eq("provider", "wise")
    .maybeSingle();

  if (!row) return { ok: false, reason: "No Wise order with that id." };

  const order: OrderState = {
    id: row.id,
    plan: row.plan === "instalments" ? "instalments" : "full",
    status: row.status,
    instalmentMonths: null,
    instalmentsPaid: 0,
    amountTotalMinor: row.amount_total_minor,
    amountPaidMinor: row.amount_paid_minor,
    grantsQuestionBankDays: row.grants_question_bank_days,
    grantsIaMarkings: row.grants_ia_markings ?? null,
  };

  const signal: PaymentSignal = {
    kind: "settled",
    objectId: transfer.transferId,
    amountMinor: transfer.amountMinor,
    currency: transfer.currency,
  };

  const plan = planFor(signal, order);

  if (plan.status) {
    const columns: Record<string, unknown> = { status: plan.status };
    if (plan.addPaidMinor) columns.amount_paid_minor = order.amountPaidMinor + plan.addPaidMinor;
    if (typeof plan.taxMinor === "number") columns.tax_amount_minor = plan.taxMinor;

    const written = await writeOrderColumns(db, orderId, columns);
    if (written.error) return { ok: false, reason: written.error };
  }

  if (plan.payment) {
    // The unique index on (order_id, provider_object_id, kind) makes a
    // redelivered webhook a no-op rather than a double count.
    await db.from("order_payments").insert({
      order_id: orderId,
      provider_object_id: plan.payment.providerObjectId,
      kind: plan.payment.kind,
      amount_minor: plan.payment.amountMinor,
      currency: plan.payment.currency,
      detail: plan.payment.detail ?? null,
    });
  }

  const settles = plan.status === "paid" || plan.status === "completed";

  if (settles) {
    const student = resolveStudent({
      buyerEmail: row.buyer_email,
      buyerName: row.buyer_name,
      studentEmail: row.student_email,
      studentName: null,
    });

    if (!student) {
      await notifyAdmins(
        db,
        "order_unmatched",
        "A Wise transfer arrived without a usable email",
        `${row.sku_name} was paid for, but the order carries no address we could use.`,
      );
    } else {
      let result = await claimOrderForBuyer(db, student.email);

      if (!result.claimed) {
        const enrolled = await enrolPaidBuyer(db, student);
        if (enrolled.status === "exists") {
          result = await claimOrderForBuyer(db, student.email);
        }

        if (!result.claimed && enrolled.status !== "invited") {
          await notifyAdmins(
            db,
            "order_unmatched",
            "A payment needs linking to a student",
            `${row.sku_name} was paid for by ${student.email}. ` +
              (enrolled.status === "off"
                ? "Automatic enrolment is switched off in settings."
                : enrolled.status === "failed"
                  ? `The invitation could not be sent: ${enrolled.reason}`
                  : result.reason),
          );
        }
      }

      if (student.boughtForSomeoneElse) {
        const parent = resolveParent({
          buyerEmail: row.buyer_email,
          buyerName: row.buyer_name,
          isGuardian: Boolean(row.buyer_is_guardian),
          student,
        });

        if (parent) {
          const invited = await enrolPaidParent(db, parent);
          if (invited.status === "failed" || invited.status === "off") {
            await notifyAdmins(
              db,
              "order_unmatched",
              "A parent account was not created",
              `${parent.email} bought ${row.sku_name} for ${parent.studentEmail}. ` +
                (invited.status === "off"
                  ? "Automatic enrolment is switched off in settings."
                  : `The invitation could not be sent: ${invited.reason}`) +
                ` They can be linked by hand on the student's page.`,
            );
          }
        }
      }
    }
  }

  if (plan.entitlement === "revoke") {
    await revokeOrderEntitlement(db, orderId);
  }

  if (plan.notifyAdmins) {
    await notifyAdmins(
      db,
      plan.notifyAdmins.kind,
      "Payment needs attention",
      `${row.sku_name}: ${plan.notifyAdmins.detail}`,
    );
  }

  return { ok: true };
}
