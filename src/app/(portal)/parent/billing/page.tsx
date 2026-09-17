import type { Metadata } from "next";

import { Badge, Card, Rule, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { formatDate, formatMoneyMinor, pluralise } from "@/lib/format";
import type { StatusTone } from "@/lib/status";
import {
  isInstalmentPlanRunning,
  type Order,
  type OrderPayment,
  type OrderStatus,
  type QuestionBankAccess,
} from "@/lib/types";

/* ==========================================================================
   /parent/billing
   --------------------------------------------------------------------------
   What a parent has paid for, and what it entitles their child to.

   The database already allowed this before the page existed: `can_read_order`
   admits a parent of the order's student, and `order_payments` is readable
   with its order. Nothing here widens access — it renders what a parent could
   always have been shown.

   Two rules carried over from /admin/orders, for the same reasons:

     · Totals are never added across currencies. A parent who bought one
       package in euro and another in Australian dollars is not helped by a
       single number that is neither.
     · A failed instalment is not a revoked entitlement. The provider retries
       for weeks, and the lessons continue. The copy has to say so, or a parent
       reads "Payment failed" and assumes their child has been cut off.

   Read-only by design. A parent cannot re-run a charge or edit an order from
   here; the honest thing is to name the amount, say what happens next, and
   give them a person to write to.
   ========================================================================== */

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

const SUPPORT_EMAIL = "hello@ownyourstudy.com";

/**
 * The same statuses as /admin/orders, said to the person who paid rather than
 * to the office. An administrator needs the pipeline stage; a parent needs to
 * know whether anything is required of them.
 */
const STATUS: Record<OrderStatus, { label: string; tone: StatusTone; detail: string }> = {
  pending: {
    label: "Not completed",
    tone: "neutral",
    detail: "This checkout was started but never finished, so nothing was charged.",
  },
  authorised: {
    label: "Authorised",
    tone: "info",
    detail: "Your bank has approved this payment. It has not been taken yet.",
  },
  paid: { label: "Paid", tone: "success", detail: "Paid in full. Nothing outstanding." },
  instalments_active: {
    label: "Plan running",
    tone: "accent",
    detail: "Collected automatically each month. Nothing for you to do.",
  },
  past_due: {
    label: "Payment didn't go through",
    tone: "danger",
    detail:
      "The last instalment was declined. Lessons carry on as normal — your card is retried automatically over the next few days, and it usually succeeds on the second attempt.",
  },
  completed: {
    label: "Completed",
    tone: "success",
    detail: "Every instalment was collected. Nothing outstanding.",
  },
  refunded: { label: "Refunded", tone: "warning", detail: "This payment was returned in full." },
  cancelled: { label: "Cancelled", tone: "neutral", detail: "Cancelled. Nothing was charged." },
};

const PAYMENT_KIND: Record<OrderPayment["kind"], string> = {
  payment: "Paid",
  refund: "Refunded",
  failure: "Declined",
  dispute: "Disputed",
};

/* -- one order ------------------------------------------------------------ */

function OrderCard({ order, payments }: { order: Order; payments: OrderPayment[] }) {
  const status = STATUS[order.status];
  const onAPlan = isInstalmentPlanRunning(order);
  const outstanding = Math.max(0, order.amountTotalMinor - order.amountPaidMinor);

  return (
    <Card as="li" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold text-ink">{order.skuName}</p>
          <p className="mt-0.5 text-sm text-ink-500">Bought {formatDate(order.createdAt)}</p>
        </div>
        <div className="text-right">
          <p className="font-semibold tabular-nums text-ink">
            {formatMoneyMinor(order.amountTotalMinor, order.currency)}
          </p>
          {order.taxAmountMinor > 0 ? (
            <p className="text-xs text-ink-300">
              incl. {formatMoneyMinor(order.taxAmountMinor, order.currency)} tax
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={status.tone}>{status.label}</Badge>
        <p className="max-w-[60ch] text-sm leading-relaxed text-ink-500">{status.detail}</p>
      </div>

      {/* An instalment plan is the one thing here with a future: what has been
          taken, and what has not been taken yet. */}
      {order.instalmentMonths !== null ? (
        <div className="rounded-[10px] border border-rule bg-paper-2 px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-ink">
              Instalment {order.instalmentsPaid} of {order.instalmentMonths}
            </p>
            <p className="text-sm tabular-nums text-ink-500">
              {formatMoneyMinor(order.amountPaidMinor, order.currency)} of{" "}
              {formatMoneyMinor(order.amountTotalMinor, order.currency)}
            </p>
          </div>
          <div
            className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-rule"
            role="img"
            aria-label={`${order.instalmentsPaid} of ${order.instalmentMonths} instalments paid`}
          >
            <div
              className={status.tone === "danger" ? "h-full bg-danger" : "h-full bg-accent"}
              style={{
                width: `${Math.min(100, (order.instalmentsPaid / order.instalmentMonths) * 100)}%`,
              }}
            />
          </div>
          {onAPlan && outstanding > 0 ? (
            <p className="mt-2 text-xs text-ink-300">
              {formatMoneyMinor(outstanding, order.currency)} still to be collected.
            </p>
          ) : null}
        </div>
      ) : null}

      {payments.length > 0 ? (
        <>
          <Rule />
          <div>
            <p className="eyebrow mb-2.5">Payments</p>
            <ul className="space-y-1.5">
              {payments.map((payment) => (
                <li
                  key={payment.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-sm"
                >
                  <span className="text-ink-700">
                    {PAYMENT_KIND[payment.kind]} · {formatDate(payment.occurredAt)}
                    {payment.detail ? (
                      <span className="text-ink-300"> · {payment.detail}</span>
                    ) : null}
                  </span>
                  <span className="tabular-nums text-ink">
                    {payment.kind === "refund" ? "−" : ""}
                    {formatMoneyMinor(payment.amountMinor, payment.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </Card>
  );
}

/* -- what the money bought ------------------------------------------------ */

function AccessCard({ access, childName }: { access: QuestionBankAccess; childName: string }) {
  const remaining = Math.max(0, access.freeAtHours - access.pooledHours);

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <p className="font-display text-lg font-semibold text-ink">Question banks</p>
        <Badge tone={access.granted ? "success" : "neutral"}>
          {access.granted ? "Included" : "Not included"}
        </Badge>
      </div>

      <p className="max-w-[60ch] text-sm leading-relaxed text-ink-500">
        {access.granted
          ? access.source === "pooled-hours"
            ? `Included at no extra cost, because ${childName} has booked ${pluralise(access.pooledHours, "tutoring hour")}.`
            : access.expiresAt
              ? `Paid for on ${childName}'s account, running to ${formatDate(access.expiresAt)}.`
              : `Paid for on ${childName}'s account.`
          : `An add-on, and also included once ${childName} has booked ${pluralise(access.freeAtHours, "tutoring hour")}.`}
      </p>

      {!access.granted ? (
        <div>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-ink-700">
              {pluralise(access.pooledHours, "hour")} booked so far
            </span>
            <span className="tabular-nums text-ink-300">
              {pluralise(remaining, "hour")} to go
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-rule"
            role="img"
            aria-label={`${access.pooledHours} of ${access.freeAtHours} hours towards included question bank access`}
          >
            <div
              className="h-full bg-accent"
              style={{
                width: `${Math.min(100, (access.pooledHours / access.freeAtHours) * 100)}%`,
              }}
            />
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/* -- the page ------------------------------------------------------------- */

export default async function ParentBilling() {
  const session = await requireRole("parent");
  const repo = await repositoryFor(session);

  const children = await repo.listStudents();
  if (children.length === 0) {
    return (
      <EmptyState
        title="No children linked to your account yet"
        description="Your coordinator links a parent account to a student. Once that is done, anything bought for them will appear here."
      />
    );
  }

  const accounts = await Promise.all(
    children.map(async (child) => {
      const [orders, access] = await Promise.all([
        repo.listOrdersForStudent(child.id),
        repo.getQuestionBankAccess(child.id),
      ]);
      const payments = await Promise.all(
        orders.map(async (order) => [order.id, await repo.getOrderPayments(order.id)] as const),
      );
      return { child, orders, access, payments: new Map(payments) };
    }),
  );

  const needsAttention = accounts.flatMap(({ child, orders }) =>
    orders.filter((o) => o.status === "past_due").map((order) => ({ child, order })),
  );

  return (
    <div className="space-y-10">
      <SectionHead
        as="h1"
        title="Billing"
        description="What you have paid for, and what it covers."
      />

      {/* Ordered by what needs a person, not by what happened most recently. */}
      {needsAttention.length > 0 ? (
        <Card className="border-danger/25 bg-danger-wash">
          <p className="font-display text-lg font-semibold text-ink">
            {needsAttention.length === 1
              ? "A payment didn't go through"
              : `${needsAttention.length} payments didn't go through`}
          </p>
          <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink-700">
            {needsAttention
              .map(({ child, order }) =>
                accounts.length > 1
                  ? `${order.skuName} for ${child.profile.firstName}`
                  : order.skuName,
              )
              .join(", ")}
            . Your card is retried automatically over the next few days, and lessons carry on
            in the meantime. If it keeps failing, write to{" "}
            <a className="font-semibold text-accent hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>{" "}
            and we will sort it out with you.
          </p>
        </Card>
      ) : null}

      {accounts.map(({ child, orders, access, payments }) => {
        /* Per currency, never blended — see the note at the top of the file. */
        const paid = new Map<string, number>();
        for (const order of orders) {
          if (order.amountPaidMinor <= 0) continue;
          if (order.status === "refunded") continue;
          paid.set(order.currency, (paid.get(order.currency) ?? 0) + order.amountPaidMinor);
        }

        return (
          <section key={child.id} className="space-y-6">
            {accounts.length > 1 ? (
              <h2 className="font-display text-2xl font-semibold">{child.profile.fullName}</h2>
            ) : null}

            {paid.size > 0 ? (
              <div className="flex flex-wrap gap-3">
                {[...paid.entries()].map(([currency, minor]) => (
                  <Card key={currency} className="px-5 py-4">
                    <p className="eyebrow">Paid to date · {currency.toUpperCase()}</p>
                    <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
                      {formatMoneyMinor(minor, currency)}
                    </p>
                  </Card>
                ))}
              </div>
            ) : null}

            <AccessCard access={access} childName={child.profile.firstName} />

            <div>
              <SectionHead title="Orders" />
              {orders.length === 0 ? (
                <EmptyState
                  title="Nothing bought yet"
                  description={`Anything bought for ${child.profile.firstName} will be listed here, with what was paid and when.`}
                />
              ) : (
                <ul className="space-y-3">
                  {orders.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      payments={payments.get(order.id) ?? []}
                    />
                  ))}
                </ul>
              )}
            </div>
          </section>
        );
      })}

      {/* A purchase made before the child was linked belongs to nobody yet, so
          it cannot appear above. An administrator matches it by hand; saying so
          is better than letting a parent conclude their money vanished. */}
      <p className="max-w-[62ch] text-xs leading-relaxed text-ink-300">
        Bought something that is not shown here? A purchase made from the website before an
        account was linked takes a day or so to be matched up. If it has been longer, write to{" "}
        <a className="font-semibold text-accent hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </div>
  );
}
