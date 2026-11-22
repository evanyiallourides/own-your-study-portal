import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckoutShell } from "@/components/checkout/checkout-shell";
import { StatusWatcher } from "@/components/checkout/status-watcher";
import { formatMoney, isCurrency } from "@/lib/catalogue";
import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bitcoin payment status", robots: { index: false, follow: false } };

export default async function BitcoinStatus({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (isDemoMode() || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) notFound();
  const { data: order, error } = await createSupabaseAdminClient().from("orders")
    .select("status, sku_name, amount_total_minor, currency, btcpay_status, btcpay_additional_status")
    .eq("id", orderId).eq("provider", "btcpay").maybeSingle();
  if (error) throw new Error("Could not read payment status");
  if (!order || !isCurrency(order.currency)) notFound();
  const paid = ["paid", "completed"].includes(order.status);
  const refunded = order.status === "refunded";
  const review = ["Expired", "Invalid"].includes(order.btcpay_status) ||
    ["PaidLate", "PaidPartial", "Marked", "Invalid"].includes(order.btcpay_additional_status);
  return (
    <CheckoutShell embed={false}>
      <div className="space-y-5">
        <h1 className="font-display text-3xl font-semibold text-ink">
          {refunded ? "Payment refunded" : paid ? "Bitcoin payment received" : review ? "Your payment needs review" : "Waiting for payment confirmation"}
        </h1>
        <p>{order.sku_name} · {formatMoney(order.amount_total_minor / 100, order.currency)}</p>
        <p className="text-ink-500">
          {refunded ? "This order has been refunded." : paid ? "Your payment has settled. If your student account is not linked yet, our team will arrange access."
            : review ? "Do not send another payment to an expired invoice. If you have already paid, contact us with the reference below so we can check it."
            : "Returning from checkout does not confirm payment. This page updates after the Bitcoin network confirmations and our payment check are complete. Please do not pay twice."}
        </p>
        {order.btcpay_additional_status === "PaidOver" && <p>Our team will review the excess payment separately.</p>}
        <p className="break-all text-sm text-ink-500">Order reference: {orderId}</p>
        {!paid && !refunded && <StatusWatcher />}
        <a href="mailto:hello@ownyourstudy.com" className="underline underline-offset-4">Contact Own Your Study</a>
      </div>
    </CheckoutShell>
  );
}
