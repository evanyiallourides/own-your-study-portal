import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";

import { env, isDemoMode } from "@/lib/env";
import { planFor, type OrderState, type PaymentSignal } from "@/lib/payments/events";
import {
  claimOrderForBuyer,
  notifyAdmins,
  revokeOrderEntitlement,
} from "@/lib/payments/entitlements";
import {
  enrolPaidBuyer,
  enrolPaidParent,
  readGuardianAnswer,
  resolveParent,
  resolveStudent,
} from "@/lib/payments/enrolment";
import { capInstalmentPlan } from "@/lib/payments/instalments";
import { writeOrderColumns } from "@/lib/payments/order-writes";
import { stripeClient, stripeConfigured } from "@/lib/payments/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* ==========================================================================
   POST /api/webhooks/stripe
   --------------------------------------------------------------------------
   Where a Stripe payment becomes an entitlement. Built to the same four
   properties as the Recall webhook next door, for the same reasons:

     · Verified — the raw body is checked against the Stripe signature before it
       is parsed. No secret configured means every request is refused, because
       an unsigned event can grant paid access.
     · Idempotent — each event is recorded in webhook_events under a unique
       (provider, event_id). Stripe retries generously; a redelivery must not
       take a second payment's worth of action.
     · Quiet — ids and event names only. No customer emails in application logs.
     · Always 2xx once accepted — a 5xx makes Stripe retry an event we have
       already stored. Failures are recorded and surfaced to administrators.

   This module's own job is narrow: verify, map Stripe's vocabulary onto the
   provider-neutral signals in lib/payments/events.ts, and write what comes
   back. What a signal *means* is decided there, shared with every other
   provider, and tested without a database.
   ========================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDER = "stripe";

/** Stripe hands back either an id or an expanded object. We only ever want the id. */
function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * Stripe's event vocabulary, mapped onto the nine things an order cares about.
 *
 * Returns null for everything we do not subscribe to, which is most of it.
 */
function signalFor(event: Stripe.Event): PaymentSignal | null {
  const object = event.data.object as unknown as Record<string, unknown>;

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = object as unknown as Stripe.Checkout.Session;
      // payment_status is widened with an escape hatch for statuses Stripe has
      // not invented yet. Anything unrecognised must read as not-yet-paid,
      // which is the only safe default for a paywall.
      const reported: string = session.payment_status;
      const settled = reported === "paid" || reported === "no_payment_required";
      return {
        // A completed session that is not yet paid is a buy-now-pay-later or a
        // delayed debit: committed, but no money has moved.
        kind: settled ? "settled" : "authorised",
        objectId: session.id,
        amountMinor: session.amount_total ?? 0,
        currency: session.currency ?? undefined,
        taxMinor: session.total_details?.amount_tax ?? 0,
      };
    }

    case "checkout.session.async_payment_failed": {
      const session = object as unknown as Stripe.Checkout.Session;
      return {
        kind: "settlement_failed",
        objectId: session.id,
        amountMinor: session.amount_total ?? 0,
        currency: session.currency ?? undefined,
      };
    }

    case "checkout.session.expired":
      return { kind: "abandoned", objectId: (object.id as string) ?? event.id };

    case "invoice.paid": {
      const invoice = object as unknown as Stripe.Invoice;
      return {
        kind: "instalment_settled",
        objectId: invoice.id ?? event.id,
        amountMinor: invoice.amount_paid ?? 0,
        currency: invoice.currency ?? undefined,
      };
    }

    case "invoice.payment_failed": {
      const invoice = object as unknown as Stripe.Invoice;
      return {
        kind: "instalment_failed",
        objectId: invoice.id ?? event.id,
        amountMinor: invoice.amount_due ?? 0,
        currency: invoice.currency ?? undefined,
      };
    }

    case "customer.subscription.deleted": {
      const subscription = object as unknown as Stripe.Subscription;
      // Deliberately no planCompleted. Stripe cancels a schedule that finished
      // and one that lapsed with the same event and the same status, so the
      // only trustworthy answer is whether the order was paid off — which
      // planFor works out from the order itself.
      return { kind: "plan_ended", objectId: subscription.id };
    }

    case "charge.refunded": {
      const charge = object as unknown as Stripe.Charge;
      return {
        kind: "refunded",
        objectId: charge.id,
        amountMinor: charge.amount,
        amountRefundedMinor: charge.amount_refunded,
        currency: charge.currency,
      };
    }

    case "charge.dispute.created": {
      const dispute = object as unknown as Stripe.Dispute;
      return {
        kind: "disputed",
        objectId: dispute.id,
        amountMinor: dispute.amount,
        currency: dispute.currency,
        detail: dispute.reason,
      };
    }

    default:
      return null;
  }
}

/** Which order an event is about. Sessions carry it; invoices and charges need a lookup. */
async function findOrderId(
  db: ReturnType<typeof createSupabaseAdminClient>,
  event: Stripe.Event,
): Promise<string | null> {
  const object = event.data.object as unknown as Record<string, unknown>;

  const metadata = object.metadata as Record<string, string> | undefined;
  const direct = metadata?.order_id ?? (object.client_reference_id as string | undefined);
  if (direct) return direct;

  const subscriptionId =
    idOf(object.subscription as string | { id: string } | null) ??
    (event.type === "customer.subscription.deleted" ? (object.id as string) : null);
  if (subscriptionId) {
    const { data } = await db
      .from("orders")
      .select("id")
      .eq("provider", PROVIDER)
      .eq("provider_subscription_id", subscriptionId)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }

  const paymentIntentId = idOf(object.payment_intent as string | { id: string } | null);
  if (paymentIntentId) {
    const { data } = await db
      .from("orders")
      .select("id")
      .eq("provider", PROVIDER)
      .eq("provider_payment_id", paymentIntentId)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }

  return null;
}

export async function POST(request: NextRequest) {
  if (isDemoMode()) {
    return NextResponse.json(
      { error: "The portal is running in demo mode and cannot accept webhooks." },
      { status: 503 },
    );
  }
  if (!stripeConfigured() || !env.stripeWebhookSecret) {
    // Fail closed. An unsigned event that is trusted grants paid content away.
    console.warn("[stripe] refused a webhook: no signing secret configured");
    return NextResponse.json({ error: "Webhooks are not configured." }, { status: 503 });
  }

  // Raw text, before any parsing — the signature covers the exact bytes sent.
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "No stripe-signature header." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    // The async variant works on both the Node and edge runtimes, so a future
    // move to the edge does not silently start failing verification.
    event = await stripeClient().webhooks.constructEventAsync(
      rawBody,
      signature,
      env.stripeWebhookSecret,
    );
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "Signature check failed.";
    console.warn("[stripe] rejected webhook:", detail);
    return NextResponse.json({ error: "Signature check failed." }, { status: 400 });
  }

  const db = createSupabaseAdminClient();

  /* -- Idempotency. The unique index is the guard, not a check-then-act select:
        two simultaneous deliveries both pass a select, but only one can win the
        insert. -- */
  const { error: insertError } = await db.from("webhook_events").insert({
    provider: PROVIDER,
    event_id: event.id,
    event_type: event.type,
    status: "received",
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ ok: true, deduplicated: true });
    }
    console.error("[stripe] could not record delivery:", insertError.code);
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
      .eq("event_id", event.id);
  };

  try {
    const signal = signalFor(event);
    if (!signal) {
      await finish("ignored", `Not subscribed to ${event.type}.`);
      return NextResponse.json({ ok: true, ignored: true });
    }

    const orderId = await findOrderId(db, event);
    if (!orderId) {
      // `stripe trigger` fixtures land here, as does any event for something we
      // did not sell. Both are fine; neither may take the endpoint down.
      await finish("ignored", "No order matches this event.");
      return NextResponse.json({ ok: true, ignored: true });
    }

    const { data: row } = await db
      .from("orders")
      .select(
        "id, plan, status, instalment_months, instalments_paid, amount_total_minor, amount_paid_minor, grants_question_bank_days, grants_ia_markings, buyer_email, sku_name",
      )
      .eq("id", orderId)
      .maybeSingle();

    if (!row) {
      await finish("ignored", "The order in the metadata no longer exists.", null);
      return NextResponse.json({ ok: true, ignored: true });
    }

    const order: OrderState = {
      id: row.id,
      plan: row.plan === "instalments" ? "instalments" : "full",
      status: row.status,
      instalmentMonths: row.instalment_months,
      instalmentsPaid: row.instalments_paid,
      amountTotalMinor: row.amount_total_minor,
      amountPaidMinor: row.amount_paid_minor,
      grantsQuestionBankDays: row.grants_question_bank_days,
      /* Nullish rather than a plain read: the column arrives as undefined on a
         database that has not run the IA migration yet, and undefined would
         make grantsSomething() true for every order ever placed. */
      grantsIaMarkings: row.grants_ia_markings ?? null,
    };

    const plan = planFor(signal, order);

    /* -- Whatever the event was, record what Stripe now knows about the buyer.
          The order was created before they typed anything. -- */
    const session = event.type.startsWith("checkout.session.")
      ? (event.data.object as unknown as Stripe.Checkout.Session)
      : null;

    const updates: Record<string, unknown> = {};
    if (session) {
      const email = session.customer_details?.email ?? session.customer_email ?? null;
      if (email) updates.buyer_email = email;
      if (session.customer_details?.name) updates.buyer_name = session.customer_details.name;
      if (session.customer_details?.address?.country) {
        updates.buyer_country = session.customer_details.address.country;
      }

      /* Checkout asked who the student is. Both fields are optional, so this
         is usually empty and the buyer is the student. */
      for (const field of session.custom_fields ?? []) {
        // The guardian question is a dropdown, so its answer is not in .text.
        if (field.key === "is_guardian") {
          updates.is_guardian_given = field.dropdown?.value ?? null;
          continue;
        }
        const value = field.text?.value?.trim();
        if (!value) continue;
        if (field.key === "student_name") updates.student_name_given = value;
        if (field.key === "student_email") updates.student_email_given = value;
      }

      const providerCustomerId = idOf(session.customer);
      if (providerCustomerId) {
        const { data: customer } = await db
          .from("customers")
          .upsert(
            {
              provider: PROVIDER,
              provider_customer_id: providerCustomerId,
              email: email ?? "",
              name: session.customer_details?.name ?? null,
            },
            { onConflict: "provider,provider_customer_id" },
          )
          .select("id")
          .maybeSingle();
        if (customer?.id) updates.customer_id = customer.id;
      }

      const paymentIntentId = idOf(session.payment_intent);
      if (paymentIntentId) updates.provider_payment_id = paymentIntentId;

      const subscriptionId = idOf(session.subscription);
      if (subscriptionId) {
        updates.provider_subscription_id = subscriptionId;

        /* Checkout can only open an OPEN-ENDED subscription. Until this runs,
           "4 monthly payments" is a subscription that bills every month for
           ever. It is therefore done here, on the session that created it, and
           a failure is an incident: the order is flagged and every
           administrator is told, because the alternative is charging somebody
           indefinitely and nobody noticing. */
        if (row.instalment_months && row.instalment_months >= 2) {
          const capped = await capInstalmentPlan(
            stripeClient(),
            subscriptionId,
            row.instalment_months,
          );
          if (capped.scheduleId) updates.provider_schedule_id = capped.scheduleId;
          if (capped.problem) {
            updates.note = `Instalment plan NOT capped: ${capped.problem}`;
            await notifyAdmins(
              db,
              "payment_failed",
              "An instalment plan is uncapped and will keep billing",
              `${row.sku_name}: the subscription schedule could not be created, so this ` +
                `subscription will bill every month until someone cancels it in Stripe. ` +
                `Subscription ${subscriptionId}. Reason: ${capped.problem}`,
            );
          }
        }
      }
    }

    /* Every settled order needs a student, not only the ones granting an
       entitlement: twenty tutoring hours need the portal their lessons and
       notes will appear in just as much as a question bank does.

       Resolved here, before the write below, because the address it produces
       is a column — claim_orders_for_profile() matches on it. */
    const settles =
      plan.status === "paid" || plan.status === "instalments_active" || plan.status === "completed";

    const student = settles
      ? resolveStudent({
          buyerEmail: (updates.buyer_email as string | undefined) ?? row.buyer_email ?? "",
          buyerName: (updates.buyer_name as string | undefined) ?? null,
          studentEmail: (updates.student_email_given as string | undefined) ?? null,
          studentName: (updates.student_name_given as string | undefined) ?? null,
        })
      : null;

    /* The buyer, when they said they were the student's parent. Null whenever
       they bought for themselves, said no, or were never asked. */
    const parent = settles
      ? resolveParent({
          buyerEmail: (updates.buyer_email as string | undefined) ?? row.buyer_email ?? "",
          buyerName: (updates.buyer_name as string | undefined) ?? null,
          isGuardian: readGuardianAnswer(updates.is_guardian_given as string | undefined),
          student,
        })
      : null;

    if (student?.boughtForSomeoneElse) {
      updates.student_email = student.email;
      updates.buyer_is_guardian = parent !== null;
      updates.note = parent
        ? `Bought by ${parent.email} for ${student.email}, who they are the parent of`
        : `Bought by ${(updates.buyer_email as string) ?? row.buyer_email} for ${student.email}`;
    }

    if (plan.status) updates.status = plan.status;
    if (plan.addPaidMinor) updates.amount_paid_minor = order.amountPaidMinor + plan.addPaidMinor;
    if (plan.countsInstalment) updates.instalments_paid = order.instalmentsPaid + 1;
    if (typeof plan.taxMinor === "number") updates.tax_amount_minor = plan.taxMinor;

    // The *_given values are how the custom fields travel between the blocks
    // above; they are not columns and must not reach the update.
    const {
      student_name_given: _n,
      student_email_given: _e,
      is_guardian_given: _g,
      ...columns
    } = updates;

    if (Object.keys(columns).length > 0) {
      const written = await writeOrderColumns(db, orderId, columns);

      if (written.skipped.length > 0) {
        // The schema is behind the code. The rest of the order was still
        // recorded, which is the point, but somebody should run the migration.
        console.warn(
          `[stripe] order ${orderId}: database has no ${written.skipped.join(", ")} — ` +
            "wrote the rest. A migration is outstanding.",
        );
      }

      if (written.error) {
        // Previously this error was not looked at, so a failed write left a
        // paid order sitting at 'pending' with nothing to say why.
        await finish("failed", `Could not update the order: ${written.error}`, orderId);
        return NextResponse.json({ ok: true, recorded: false });
      }
    }

    if (plan.payment) {
      // The unique index makes a redelivery a no-op rather than a double count.
      await db.from("order_payments").insert({
        order_id: orderId,
        provider_object_id: plan.payment.providerObjectId,
        kind: plan.payment.kind,
        amount_minor: plan.payment.amountMinor,
        currency: plan.payment.currency,
        detail: plan.payment.detail ?? null,
      });
    }

    if (settles && !student) {
      await notifyAdmins(
        db,
        "order_unmatched",
        "A payment arrived without a usable email",
        `${row.sku_name} was paid for, but neither the buyer nor the student gave an address we could use.`,
      );
    }

    if (student) {
      let result = await claimOrderForBuyer(db, student.email);

      if (!result.claimed) {
        // Nobody with that address yet. Invite them; accepting it builds the
        // account and claims the order on the way through handle_new_user().
        const enrolled = await enrolPaidBuyer(db, student);
        if (enrolled.status === "exists") {
          // Somebody registered between the payment and now.
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
    }

    /* The other half of the family.

       Unconditional rather than nested inside the student's branch above: the
       student may already have had an account, in which case nothing there
       ran, and the parent still has none. The link between the two is the
       database's job — link_parent_for_profile() makes it when whichever of
       them is second accepts — so all that is needed here is the invitation.

       A failure is reported and nothing else. The purchase is already
       recorded, the student already has what they paid for, and an
       administrator can add the parent by hand on the student's page. */
    if (parent) {
      const invited = await enrolPaidParent(db, parent);

      if (invited.status === "failed" || invited.status === "off") {
        await notifyAdmins(
          db,
          "order_unmatched",
          "A parent account was not created",
          `${parent.email} bought ${row.sku_name} for ${parent.studentEmail} and said they ` +
            `are their parent, but no parent account was invited. ` +
            (invited.status === "off"
              ? "Automatic enrolment is switched off in settings."
              : `The invitation could not be sent: ${invited.reason}`) +
            ` They can be linked by hand on the student's page.`,
        );
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

    await finish(plan.ignored ? "ignored" : "processed", plan.ignored, orderId);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "Processing failed.";
    console.error("[stripe] processing failed for event", event.id, "-", detail);
    await finish("failed", detail);
    // Still a 200: the delivery is recorded, and a retry would be dropped as a
    // duplicate anyway. The failure is visible to administrators.
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json(
    { error: "This endpoint accepts signed POST requests from Stripe only." },
    { status: 405 },
  );
}
