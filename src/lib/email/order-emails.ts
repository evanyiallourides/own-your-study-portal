import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { sendEmail } from "@/lib/email/send";
import { receiptEmail, transferDetailsEmail } from "@/lib/email/templates";
import { formatMoneyMinor } from "@/lib/format";

/* ==========================================================================
   The emails a Wise order sends, and when
   --------------------------------------------------------------------------
   Two moments, one email each:

     · the order is created   -> the transfer details, so a buyer who closes
                                 the checkout sheet still has the reference
     · the order is settled   -> the receipt

   Stripe orders are not here on purpose. Stripe sends its own receipt, and a
   second one from us would be a duplicate with different numbers on it.

   Nothing in this file may fail the order it is about. Both senders swallow
   every error and log it, with the order id and never the address: logs are
   read by more people than inboxes are.
   ========================================================================== */

/* -- the details email: who it may be sent to -------------------------------- */

/**
 * The checkout form is public, and the details email goes to whatever address
 * is typed into it. Left alone, that is a way to make this domain send mail to
 * any stranger, and a sender's reputation does not survive being used that
 * way. So one address gets at most this many in an hour — comfortably more
 * than a real person who mistyped something and tried again.
 */
export const MAX_DETAIL_EMAILS_PER_HOUR = 3;

/** `recentOrders` counts the order that has just been made. */
export function withinEmailLimit(recentOrders: number): boolean {
  return recentOrders <= MAX_DETAIL_EMAILS_PER_HOUR;
}

/** % and _ are wildcards in LIKE, and `\` is its escape; an address may hold any of them. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface TransferDetailsOrder {
  db: SupabaseClient;
  orderId: string;
  buyerEmail: string;
  buyerName: string | null;
  skuName: string;
  amountTotalMinor: number;
  currency: string;
  reference: string;
  account: { accountHolder: string; label: string; details: string[] };
  /** The portal's own origin, no trailing slash. */
  appUrl: string;
}

export async function sendTransferDetails(order: TransferDetailsOrder): Promise<void> {
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error } = await order.db
      .from("orders")
      .select("id", { count: "exact", head: true })
      .ilike("buyer_email", likeLiteral(order.buyerEmail))
      .gte("created_at", since);

    // Could not tell how many there have been: err on the side of not mailing.
    if (error || count === null) {
      console.error("[email] details not sent for order", order.orderId, "- could not count recent orders");
      return;
    }
    if (!withinEmailLimit(count)) {
      console.warn("[email] details not sent for order", order.orderId, "- address is over its hourly limit");
      return;
    }

    const content = transferDetailsEmail({
      buyerName: order.buyerName,
      skuName: order.skuName,
      amount: formatMoneyMinor(order.amountTotalMinor, order.currency),
      reference: order.reference,
      accountHolder: order.account.accountHolder,
      accountLabel: order.account.label,
      details: order.account.details,
      orderUrl: `${order.appUrl}/checkout/instructions/${order.orderId}`,
    });

    const sent = await sendEmail({
      to: order.buyerEmail,
      ...content,
      idempotencyKey: `details-${order.orderId}`,
    });
    if (!sent.ok && !sent.skipped) {
      console.error("[email] details not sent for order", order.orderId, "-", sent.reason);
    }
  } catch (cause) {
    console.error("[email] details failed for order", order.orderId, "-", cause instanceof Error ? cause.message : cause);
  }
}

/* -- the receipt: exactly once per order -------------------------------------- */

const ALREADY_SETTLED = new Set(["paid", "instalments_active", "completed"]);

/**
 * Whether settling this order should send a receipt.
 *
 * Keyed on the status the order had *before* the write, which is the one thing
 * that tells a first payment from a replay. The webhook can deliver the same
 * transfer twice and an administrator can press a button twice; neither
 * should put a second receipt in anybody's inbox. (The idempotency key on the
 * send is a second line of defence, not the first.)
 */
export function shouldSendReceipt(statusBefore: string, settles: boolean): boolean {
  return settles && !ALREADY_SETTLED.has(statusBefore);
}

/** What a purchase switched on, as a customer would say it. */
export function includedLines(grants: { questionBankDays: number | null; iaMarkings: number | null }): string[] {
  const lines: string[] = [];
  if (grants.questionBankDays !== null) {
    lines.push(`Question bank access for ${grants.questionBankDays} days`);
  }
  if (grants.iaMarkings !== null) {
    lines.push(`${grants.iaMarkings} IA marking review${grants.iaMarkings === 1 ? "" : "s"}`);
  }
  return lines;
}

export interface ReceiptOrder {
  orderId: string;
  buyerEmail: string;
  buyerName: string | null;
  skuName: string;
  quantity: number;
  amountMinor: number;
  currency: string;
  reference: string | null;
  questionBankDays: number | null;
  iaMarkings: number | null;
  portalUrl: string;
}

export async function sendPaymentReceipt(order: ReceiptOrder): Promise<void> {
  try {
    const reference = order.reference ?? "your order";
    const content = receiptEmail({
      buyerName: order.buyerName,
      skuName: order.skuName,
      quantity: order.quantity,
      amount: formatMoneyMinor(order.amountMinor, order.currency),
      reference,
      paidOn: new Date().toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      included: includedLines({ questionBankDays: order.questionBankDays, iaMarkings: order.iaMarkings }),
      portalUrl: order.portalUrl,
    });

    const sent = await sendEmail({
      to: order.buyerEmail,
      ...content,
      idempotencyKey: `receipt-${order.orderId}`,
    });
    if (!sent.ok && !sent.skipped) {
      console.error("[email] receipt not sent for order", order.orderId, "-", sent.reason);
    }
  } catch (cause) {
    console.error("[email] receipt failed for order", order.orderId, "-", cause instanceof Error ? cause.message : cause);
  }
}
