import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export interface BtcPayConfig { url: string; storeId: string; apiKey: string; webhookSecret: string }

/** Explicit live opt-in. The public demonstration servers must never take orders. */
export function btcPayConfig(source: Record<string, string | undefined> = process.env): BtcPayConfig | null {
  if (source.BTCPAY_LIVE_ENABLED !== "true" || source.BTCPAY_NETWORK !== "mainnet") return null;
  const storeId = source.BTCPAY_STORE_ID?.trim();
  const apiKey = source.BTCPAY_API_KEY?.trim();
  const webhookSecret = source.BTCPAY_WEBHOOK_SECRET?.trim();
  if (!storeId || !apiKey || !webhookSecret) return null;
  try {
    const url = new URL(source.BTCPAY_URL ?? "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
        url.pathname !== "/" || /(^|[.-])(testnet|regtest|signet|demo)([.-]|$)/i.test(url.hostname) ||
        url.hostname === "localhost" || !url.hostname.includes(".")) return null;
    return { url: url.origin, storeId, apiKey, webhookSecret };
  } catch { return null; }
}

export function verifyBtcPaySignature(body: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body, "utf8").digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}

/** Exact decimal conversion: never round an invoice amount into a match. */
export function fiatMinor(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  if (/[1-9]/.test(fraction.slice(2))) return null;
  const minor = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(minor) ? minor : null;
}

export interface BtcPayInvoice {
  id: string; storeId?: string; amount: string; currency: string;
  status: string; additionalStatus: string; checkoutLink: string;
  metadata?: { orderId?: string };
}
export interface BtcPayOrder {
  id: string; provider_checkout_id: string; currency: string; amount_total_minor: number;
}

export function invoiceMatches(invoice: BtcPayInvoice, order: BtcPayOrder, storeId: string): boolean {
  return invoice.id === order.provider_checkout_id &&
    (!invoice.storeId || invoice.storeId === storeId) && invoice.metadata?.orderId === order.id &&
    invoice.currency?.toLowerCase() === order.currency && fiatMinor(invoice.amount) === order.amount_total_minor;
}
export function isSettledInvoice(invoice: BtcPayInvoice): boolean {
  return invoice.status === "Settled" && ["None", "PaidOver"].includes(invoice.additionalStatus);
}
export function safeCheckoutLink(link: unknown, config: BtcPayConfig): string | null {
  if (typeof link !== "string") return null;
  try {
    const url = new URL(link);
    return url.origin === config.url && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export async function btcPayFetch<T>(config: BtcPayConfig, suffix: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${config.url}/api/v1/stores/${encodeURIComponent(config.storeId)}${suffix}`, {
    ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", Authorization: `token ${config.apiKey}` },
  });
  if (!response.ok) throw new Error(`BTCPay HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

/** Check the actual invoice destination too; an operator's network label is not proof. */
export function hasMainnetBitcoinDestination(methods: unknown): boolean {
  if (!Array.isArray(methods)) return false;
  return methods.some((method) => method?.paymentMethodId === "BTC-CHAIN" &&
    typeof method.destination === "string" &&
    (/^bc1[ac-hj-np-z02-9]{11,87}$/.test(method.destination) ||
     /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(method.destination)));
}
