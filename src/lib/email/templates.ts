/* ==========================================================================
   The two emails a bank-transfer buyer gets
   --------------------------------------------------------------------------
   Pure functions from plain data to { subject, html, text } — no sending, no
   database — so what a customer reads can be tested and looked at without
   anything being delivered.

   Every value interpolated into the HTML is escaped. Most of what is shown
   was typed into a public form by a stranger (the buyer's name, above all),
   and an email is a place where markup in a name is not a curiosity: it is
   something that arrives in somebody else's inbox under our sender address.

   Written to survive a poor mail client: one column, inline styles, no images,
   no web fonts, and a plain-text version that stands on its own.
   ========================================================================== */

import { splitDetailLine } from "@/lib/payments/detail-line";

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/** The seller, as published in terms.html — the one place the legal name and ABN live. */
export const SELLER = {
  legalName: "Dr Michalis Paediatrics Pty Ltd",
  abn: "64 688 272 988",
  tradingAs: "Own Your Study",
} as const;

const INK = "#14202f";
const MUTED = "#4a5a6d";
const ACCENT = "#635bff";
const PAPER = "#faf7f1";
const RULE = "#e4ddcd";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const e = escapeHtml;

/** "Sophia Thompson" -> "Hi Sophia,". No name, no guess. */
function greeting(name: string | null): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first ? `Hi ${first},` : "Hello,";
}

function row(label: string, value: string, emphasis = false): string {
  return (
    `<tr><td style="padding:10px 0;border-bottom:1px solid ${RULE};">` +
    `<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${MUTED};font-weight:600;">${e(label)}</div>` +
    `<div style="margin-top:2px;font-size:${emphasis ? "20px" : "15px"};font-weight:${emphasis ? "700" : "400"};color:${INK};word-break:break-word;">${e(value)}</div>` +
    `</td></tr>`
  );
}

function button(href: string, label: string): string {
  return (
    `<p style="margin:28px 0 8px;"><a href="${e(href)}" ` +
    `style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;` +
    `padding:13px 26px;border-radius:999px;">${e(label)}</a></p>`
  );
}

function shell(preheader: string, body: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>Own Your Study</title></head>` +
    `<body style="margin:0;padding:0;background:${PAPER};">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${RULE};border-radius:16px;">` +
    `<tr><td style="padding:32px 30px;font-family:${FONT};font-size:15px;line-height:1.55;color:${INK};">` +
    `<div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:${ACCENT};margin-bottom:18px;">Own Your Study</div>` +
    body +
    `<p style="margin:28px 0 0;padding-top:18px;border-top:1px solid ${RULE};font-size:12px;color:${MUTED};">` +
    `Questions? Just reply to this email.<br>` +
    `${e(SELLER.legalName)}, ABN ${e(SELLER.abn)}, trading as ${e(SELLER.tradingAs)}.</p>` +
    `</td></tr></table></td></tr></table></body></html>`
  );
}

/* -- 1. the transfer details, straight after checkout ---------------------- */

export interface TransferDetailsInput {
  buyerName: string | null;
  skuName: string;
  /** Already formatted for a person: "€620". */
  amount: string;
  reference: string;
  accountHolder: string;
  accountLabel: string;
  /** One line each: "IBAN: BE56 ...". */
  details: string[];
  /** The live instructions page for this order. */
  orderUrl: string;
}

export function transferDetailsEmail(input: TransferDetailsInput): EmailContent {
  const subject = `Your bank transfer details — ${input.reference}`;

  const rows =
    row("Amount", input.amount, true) +
    row("Reference", input.reference, true) +
    row("Account holder", input.accountHolder) +
    input.details
      .map((line) => {
        const { label, value } = splitDetailLine(line);
        return row(label, value);
      })
      .join("");

  const html = shell(
    `Send ${input.amount} quoting ${input.reference}. Nothing has been charged yet.`,
    `<p style="margin:0 0 14px;">${e(greeting(input.buyerName))}</p>` +
      `<p style="margin:0 0 14px;">Here is what you need to pay for <strong>${e(input.skuName)}</strong>. ` +
      `Nothing has been charged yet &mdash; the money moves when you make this transfer from your own bank.</p>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;border-top:1px solid ${RULE};">${rows}</table>` +
      `<p style="margin:0 0 14px;"><strong>Quote the reference exactly</strong> &mdash; it is how we know the payment is yours. ` +
      `Send the full amount so the whole of it arrives; some banks take a fee off the top.</p>` +
      `<p style="margin:0 0 14px;">${e(input.accountLabel)}. Transfers usually take one to two business days. ` +
      `We will email you a receipt as soon as yours is matched.</p>` +
      button(input.orderUrl, "Open your payment page") +
      `<p style="margin:0;font-size:13px;color:${MUTED};">That page updates by itself when your transfer arrives.</p>`,
  );

  const text = [
    greeting(input.buyerName),
    "",
    `Here is what you need to pay for ${input.skuName}. Nothing has been charged yet - the money moves when you make this transfer from your own bank.`,
    "",
    `Amount:         ${input.amount}`,
    `Reference:      ${input.reference}`,
    `Account holder: ${input.accountHolder}`,
    ...input.details.map((line) => `                ${line}`),
    "",
    "Quote the reference exactly - it is how we know the payment is yours. Send the full amount so the whole of it arrives; some banks take a fee off the top.",
    "",
    `${input.accountLabel}. Transfers usually take one to two business days. We will email you a receipt as soon as yours is matched.`,
    "",
    `Your payment page: ${input.orderUrl}`,
    "",
    "Questions? Just reply to this email.",
    `${SELLER.legalName}, ABN ${SELLER.abn}, trading as ${SELLER.tradingAs}.`,
  ].join("\n");

  return { subject, html, text };
}

/* -- 2. the receipt, once the payment is matched ---------------------------- */

export interface ReceiptInput {
  buyerName: string | null;
  skuName: string;
  quantity: number;
  amount: string;
  reference: string;
  /** Already formatted: "19 October 2026". */
  paidOn: string;
  /** What the purchase switched on, in words. May be empty. */
  included: string[];
  portalUrl: string;
}

export function receiptEmail(input: ReceiptInput): EmailContent {
  const subject = `Payment received — ${input.reference}`;
  const item = input.quantity > 1 ? `${input.skuName} × ${input.quantity}` : input.skuName;

  const rows =
    row("Item", item) +
    row("Amount received", input.amount, true) +
    row("Reference", input.reference) +
    row("Date received", input.paidOn) +
    row("Paid by", "Bank transfer (Wise)") +
    row("Paid to", `${SELLER.legalName} (ABN ${SELLER.abn}), trading as ${SELLER.tradingAs}`);

  const includedHtml = input.included.length
    ? `<p style="margin:0 0 6px;"><strong>Included with this purchase</strong></p>` +
      `<ul style="margin:0 0 14px;padding-left:20px;">${input.included.map((line) => `<li>${e(line)}</li>`).join("")}</ul>`
    : "";

  const html = shell(
    `We have received ${input.amount} for ${input.skuName}.`,
    `<p style="margin:0 0 14px;">${e(greeting(input.buyerName))}</p>` +
      `<p style="margin:0 0 14px;">Thank you &mdash; your bank transfer has arrived and been matched to your order. ` +
      `Keep this email as your receipt.</p>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;border-top:1px solid ${RULE};">${rows}</table>` +
      includedHtml +
      `<p style="margin:0 0 14px;">Your access is set up automatically. If you are new to the portal, look out for a separate ` +
      `invitation email to create your login &mdash; if it has not arrived, reply here and we will sort it out.</p>` +
      button(input.portalUrl, "Go to the portal"),
  );

  const text = [
    greeting(input.buyerName),
    "",
    "Thank you - your bank transfer has arrived and been matched to your order. Keep this email as your receipt.",
    "",
    `Item:            ${item}`,
    `Amount received: ${input.amount}`,
    `Reference:       ${input.reference}`,
    `Date received:   ${input.paidOn}`,
    "Paid by:         Bank transfer (Wise)",
    `Paid to:         ${SELLER.legalName} (ABN ${SELLER.abn}), trading as ${SELLER.tradingAs}`,
    "",
    ...(input.included.length ? ["Included with this purchase:", ...input.included.map((line) => `  - ${line}`), ""] : []),
    "Your access is set up automatically. If you are new to the portal, look out for a separate invitation email to create your login - if it has not arrived, reply here and we will sort it out.",
    "",
    `Go to the portal: ${input.portalUrl}`,
    "",
    "Questions? Just reply to this email.",
    `${SELLER.legalName}, ABN ${SELLER.abn}, trading as ${SELLER.tradingAs}.`,
  ].join("\n");

  return { subject, html, text };
}
