import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { findOrderByReference } from "@/lib/payments/wise-reference";
import { settleWiseTransfer } from "@/lib/payments/wise-settle";
import { verifyWiseWebhookSignature, wiseConfigured, wiseFetch } from "@/lib/payments/wise";
import { parseIncomingTransferEvent } from "@/lib/payments/wise-webhook-event";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* ==========================================================================
   POST /api/webhooks/wise
   --------------------------------------------------------------------------
   Where a Wise transfer becomes an entitlement. Built to the same four
   properties as the Stripe webhook next door, for the same reasons:

     · Verified — the raw body is checked against Wise's own RSA signature
       (X-Signature-SHA256, see wise.ts) before it is parsed. No public key
       configured means every request is refused, because an unverified
       delivery accepted on trust can grant paid access to whoever finds this
       URL.
     · Idempotent — each event is recorded in webhook_events under a unique
       (provider, event_id). Wise, like Stripe, can redeliver; a repeat must
       not settle the same order's payment twice, which is also why
       order_payments itself is keyed to make a double count impossible.
     · Quiet — ids only. No buyer emails in application logs.
     · Always 2xx once accepted — a 5xx here makes Wise retry an event already
       stored. Failures are recorded and surfaced to administrators instead.

   UNVERIFIED AGAINST A REAL DELIVERY: parseIncomingTransferEvent
   (wise-webhook-event.ts) and fetchIncomingTransfer below are written against
   Wise's generally-documented webhook shape — a thin `incoming-transfer#credited`
   event carrying a resource id, resolved by a follow-up GET for the full
   transfer — but the exact field names in both the event envelope and that
   follow-up response were not confirmed against Wise's current API reference
   while this was written. Confirm both against a real test delivery (Wise's
   dashboard can send one) before relying on this in production, and correct
   those two functions alone if they disagree — everything downstream
   (settleWiseTransfer, the order matching, the idempotency record) does not
   need to change either way.
   ========================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDER = "wise";

interface IncomingTransferDetail {
  amountMinor: number;
  currency: string;
  reference: string | null;
}

/** The full resource behind a thin event. Endpoint path UNVERIFIED — see the header comment. */
async function fetchIncomingTransfer(transferId: string): Promise<IncomingTransferDetail> {
  const transfer = await wiseFetch<Record<string, unknown>>(`/v1/incoming-transfers/${transferId}`);
  const amount = transfer.amount as Record<string, unknown> | undefined;

  return {
    amountMinor: Math.round(Number(amount?.value ?? transfer.amountValue ?? 0) * 100),
    currency: String(amount?.currency ?? transfer.currency ?? "").toLowerCase(),
    reference: typeof transfer.reference === "string" ? transfer.reference : null,
  };
}

export async function POST(request: NextRequest) {
  if (!wiseConfigured() || !env.wiseWebhookPublicKey) {
    // Fail closed. An unverified event that is trusted grants paid access away.
    console.warn("[wise] refused a webhook: not configured");
    return NextResponse.json({ error: "Webhooks are not configured." }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-signature-sha256");

  if (!verifyWiseWebhookSignature(rawBody, signature)) {
    console.warn("[wise] rejected webhook: signature check failed");
    return NextResponse.json({ error: "Signature check failed." }, { status: 400 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Malformed body." }, { status: 400 });
  }

  const event = parseIncomingTransferEvent(parsed);
  if (!event) {
    return NextResponse.json({ error: "Unrecognised event shape." }, { status: 400 });
  }

  const db = createSupabaseAdminClient();

  const { error: insertError } = await db.from("webhook_events").insert({
    provider: PROVIDER,
    event_id: event.eventId,
    event_type: event.eventType,
    status: "received",
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ ok: true, deduplicated: true });
    }
    console.error("[wise] could not record delivery:", insertError.code);
    return NextResponse.json({ error: "Could not record the delivery." }, { status: 500 });
  }

  const finish = async (status: string, detail?: string, orderId?: string | null) => {
    await db
      .from("webhook_events")
      .update({
        status,
        processed_at: new Date().toISOString(),
        error_message: detail ?? null,
        ...(orderId ? { order_id: orderId } : {}),
      })
      .eq("provider", PROVIDER)
      .eq("event_id", event.eventId);
  };

  try {
    if (event.eventType !== "incoming-transfer#credited" || !event.transferId) {
      await finish("ignored", `Not subscribed to ${event.eventType}.`);
      return NextResponse.json({ ok: true, ignored: true });
    }

    const detail = await fetchIncomingTransfer(event.transferId);

    if (!detail.reference) {
      await db.from("wise_unmatched_transfers").insert({
        wise_transfer_id: event.transferId,
        amount_minor: detail.amountMinor,
        currency: detail.currency,
        reference_received: null,
      });
      await finish("ignored", "Transfer carried no reference.");
      return NextResponse.json({ ok: true, unmatched: true });
    }

    const order = await findOrderByReference(db, detail.reference);
    if (!order) {
      await db.from("wise_unmatched_transfers").insert({
        wise_transfer_id: event.transferId,
        amount_minor: detail.amountMinor,
        currency: detail.currency,
        reference_received: detail.reference,
      });
      await finish("ignored", `No order matches reference ${detail.reference}.`);
      return NextResponse.json({ ok: true, unmatched: true });
    }

    const settled = await settleWiseTransfer(db, order.id, {
      transferId: event.transferId,
      amountMinor: detail.amountMinor,
      currency: detail.currency,
    });

    if (!settled.ok) {
      await finish("failed", settled.reason, order.id);
      return NextResponse.json({ ok: true, recorded: false });
    }

    await finish("processed", undefined, order.id);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Processing failed.";
    console.error("[wise] processing failed for event", event.eventId, "-", message);
    await finish("failed", message);
    // Still a 200: the delivery is recorded, and a retry would be dropped as a
    // duplicate anyway. The failure is visible to administrators.
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json(
    { error: "This endpoint accepts signed POST requests from Wise only." },
    { status: 405 },
  );
}
