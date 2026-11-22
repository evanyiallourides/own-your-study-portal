import { NextResponse, type NextRequest } from "next/server";
import { btcPayConfig, btcPayFetch, invoiceMatches, isSettledInvoice, verifyBtcPaySignature,
  type BtcPayInvoice, type BtcPayOrder } from "@/lib/payments/btcpay";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const config = btcPayConfig();
  if (!config) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 65536) return NextResponse.json({ error: "Body too large" }, { status: 413 });
  if (!verifyBtcPaySignature(raw, request.headers.get("btcpay-sig"), config.webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  let event: { type?: string; storeId?: string; invoiceId?: string };
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!event || event.storeId !== config.storeId || typeof event.invoiceId !== "string") {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }
  if (!["InvoiceSettled", "InvoiceExpired", "InvoiceInvalid", "InvoiceProcessing", "InvoiceReceivedPayment"].includes(event.type ?? "")) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  try {
    const db = createSupabaseAdminClient();
    const { data: order, error } = await db.from("orders")
      .select("id, provider_checkout_id, currency, amount_total_minor")
      .eq("provider", "btcpay").eq("provider_checkout_id", event.invoiceId).maybeSingle<BtcPayOrder>();
    if (error) throw new Error("Order lookup failed");
    // Creation may have succeeded just before its order mapping was persisted; retry rather than discard.
    if (!order) return NextResponse.json({ error: "Order mapping not ready" }, { status: 503 });
    const invoice = await btcPayFetch<BtcPayInvoice>(config, `/invoices/${encodeURIComponent(event.invoiceId)}`);
    if (!invoiceMatches(invoice, order, config.storeId)) throw new Error("Invoice does not match order");
    if (!isSettledInvoice(invoice)) {
      const { error: updateError } = await db.from("orders").update({ btcpay_status: invoice.status,
        btcpay_additional_status: invoice.additionalStatus }).eq("id", order.id).eq("status", "pending");
      if (updateError) throw new Error("Could not record invoice status");
      return NextResponse.json({ ok: true, settled: false });
    }
    // Row lock, amount/currency checks, ledger write and existing student's entitlement are atomic.
    // Return 5xx on failure so BTCPay can retry; never acknowledge a dropped settlement.
    const { error: settleError } = await db.rpc("settle_btcpay_order", {
      p_order_id: order.id, p_invoice_id: invoice.id,
      p_amount_minor: order.amount_total_minor, p_currency: order.currency,
      p_additional_status: invoice.additionalStatus,
    });
    if (settleError) throw new Error("Settlement failed");
    return NextResponse.json({ ok: true });
  } catch {
    console.error("[btcpay] invoice reconciliation failed; delivery may be retried");
    return NextResponse.json({ error: "Reconciliation failed" }, { status: 503 });
  }
}
