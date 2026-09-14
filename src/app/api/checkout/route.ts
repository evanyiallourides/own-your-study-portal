import { NextResponse, type NextRequest } from "next/server";

import {
  amountFor,
  baseCurrencyFor,
  isCurrency,
  priceIdFor,
  skuFor,
  toMinorUnits,
  type Currency,
  type Plan,
} from "@/lib/catalogue";
import { env, isDemoMode } from "@/lib/env";
import {
  paymentMethodConfiguration,
  requireStripeMode,
  stripeClient,
  stripeConfigured,
} from "@/lib/payments/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* ==========================================================================
   POST /api/checkout
   --------------------------------------------------------------------------
   Turns a form post from the public checkout page into a Stripe Checkout
   Session and redirects to it.

   Public by design — buyers arrive from the static marketing site with no
   account, and the portal has no self-signup. That makes validation the whole
   of the security here:

     · the slug must be a key in the catalogue, so "../" and junk are simply not
       keys — the same defence the question bank routes use;
     · the currency must be one of four;
     · quantity is clamped, and refused outright on SKUs that are not sold by
       the unit;
     · the IB-only SKU cannot be bought from another sub-site.

   The order row is written *before* the redirect. That costs a little noise —
   an abandoned checkout leaves a `pending` row, and a bot could make some —
   but it means the webhook has an unambiguous key to match on, and an
   abandoned checkout is visible rather than invisible. Expired sessions clean
   themselves up.
   ========================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUANTITY = 20;

function refuse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  /* Validate before checking whether payments are switched on. A malformed
     request is malformed either way, and answering every one of them with
     "not configured" hides real bugs behind a deployment state — including
     from the tests. */
  const form = await request.formData();
  const read = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value.trim() : null;
  };

  const sku = skuFor(read("sku"));
  if (!sku) return refuse("That is not something we sell.");

  const plan: Plan = read("plan") === "instalments" ? "instalments" : "full";
  if (plan === "instalments" && !sku.instalments) {
    return refuse("That package is not sold on a payment plan.");
  }

  /* Digital content cannot be sold as non-refundable unless the buyer asked
     for immediate access and acknowledged losing the cancellation right. The
     checkbox is required in the markup; this is the half that cannot be
     removed with dev tools. */
  if (sku.grants !== null && read("waive_cooling_off") !== "yes") {
    return refuse("Please confirm you want access straight away.");
  }

  const site = read("site");
  if (sku.ibOnly && site !== "own-your-ib") {
    // The question banks are IB content. Every sub-site links to the SKU, but
    // only one of them ships anything it unlocks.
    return refuse("That is only available from Own Your IB.");
  }

  const requestedCurrency = read("ccy");
  const currency: Currency =
    requestedCurrency && isCurrency(requestedCurrency)
      ? requestedCurrency
      : baseCurrencyFor(site);

  let quantity = Number.parseInt(read("qty") ?? "1", 10);
  if (!Number.isFinite(quantity) || quantity < 1) quantity = 1;
  if (quantity > MAX_QUANTITY) quantity = MAX_QUANTITY;
  if (quantity > 1 && !sku.quantityAdjustable) {
    return refuse("That package is sold one at a time.");
  }

  if (isDemoMode()) {
    return refuse("The portal is running in demo mode and cannot take payments.", 503);
  }
  if (!stripeConfigured()) {
    return refuse("Payments are not configured on this deployment.", 503);
  }

  const mode = requireStripeMode();
  const priceId = priceIdFor(sku, plan, mode);
  if (!priceId) {
    // The catalogue knows the price; Stripe has not been told about it yet.
    return refuse("That is not on sale yet. Please get in touch.", 503);
  }

  // Stripe charges from the price ID; this is recorded so the order says what
  // it was sold for without a round trip, and is reconciled from the session.
  const totalMinor = toMinorUnits(amountFor(sku, currency, "full")) * quantity;

  const db = createSupabaseAdminClient();
  const { data: order, error } = await db
    .from("orders")
    .insert({
      sku_slug: sku.slug,
      sku_name: sku.name,
      plan,
      quantity,
      instalment_months: plan === "instalments" ? sku.instalments?.months ?? null : null,
      currency,
      amount_total_minor: totalMinor,
      grants_question_bank_days: sku.grants?.questionBankDays ?? null,
      provider: "stripe",
      status: "pending",
      // Overwritten from the session once Stripe has collected it. Not null,
      // so something has to go here until then.
      buyer_email: "",
      source_site: site,
    })
    .select("id")
    .single();

  if (error || !order) {
    console.error("[checkout] could not record the order:", error?.code);
    return refuse("Could not start checkout. Please try again.", 500);
  }

  const appUrl = env.appUrl.replace(/\/$/, "");

  try {
    const session = await stripeClient().checkout.sessions.create(
      {
        mode: plan === "instalments" ? "subscription" : "payment",
        line_items: [
          {
            price: priceId,
            quantity,
            ...(sku.quantityAdjustable && plan === "full"
              ? { adjustable_quantity: { enabled: true, minimum: 1, maximum: MAX_QUANTITY } }
              : {}),
          },
        ],
        currency,
        // Explicitly off. Adaptive Pricing would convert with Stripe's own rate
        // and quietly disagree with the price the site just quoted.
        adaptive_pricing: { enabled: false },
        // Stripe Tax needs an address to decide whether Australian GST applies.
        automatic_tax: { enabled: true },
        billing_address_collection: "required",
        payment_method_configuration: paymentMethodConfiguration(plan),
        /* Who is this for?
           The payer is often a parent. Without asking, a child's lessons end up
           on their mother's account and the question bank licence with them.
           Both optional and both labelled for the common case, which is that
           the buyer is the student and leaves them blank. */
        custom_fields: [
          {
            key: "student_name",
            label: { type: "custom", custom: "Student's name (leave blank if it's you)" },
            type: "text",
            optional: true,
            text: { maximum_length: 80 },
          },
          {
            key: "student_email",
            label: { type: "custom", custom: "Student's email (leave blank if it's yours)" },
            type: "text",
            optional: true,
            text: { maximum_length: 120 },
          },
        ],
        client_reference_id: order.id,
        metadata: { order_id: order.id, sku: sku.slug, plan, site: site ?? "" },
        // Invoice events carry the *subscription's* metadata, not the session's,
        // so an instalment plan needs it in both places or every renewal
        // arrives unattributable.
        ...(plan === "instalments"
          ? { subscription_data: { metadata: { order_id: order.id, sku: sku.slug } } }
          : { customer_creation: "always" }),
        success_url: `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/checkout/cancelled?order=${order.id}`,
      },
      // Retrying this exact order must not create a second session.
      { idempotencyKey: `checkout_${order.id}` },
    );

    await db
      .from("orders")
      .update({ provider_checkout_id: session.id })
      .eq("id", order.id);

    if (!session.url) {
      return refuse("Stripe did not return a checkout URL.", 502);
    }

    return NextResponse.redirect(session.url, {
      status: 303,
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "Checkout failed.";
    console.error("[checkout] Stripe refused the session:", detail);
    await db.from("orders").update({ status: "cancelled", note: detail }).eq("id", order.id);
    return refuse("Could not start checkout. Please try again.", 502);
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "This endpoint accepts a form post from the checkout page." },
    { status: 405 },
  );
}
